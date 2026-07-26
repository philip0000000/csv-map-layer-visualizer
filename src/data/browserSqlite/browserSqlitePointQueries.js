import {
  queryBrowserSqliteGeometries,
} from './browserSqliteGeometryQueries.js';

export const DEFAULT_BROWSER_SQLITE_RENDER_BUDGET = 1_000;
export const MAX_BROWSER_SQLITE_RENDER_BUDGET = 10_000;

/**
 * Query compact browser-SQLite point results for one normalized map viewport.
 *
 * Bounds, enabled datasets, and timeline constraints are applied in SQLite
 * before the render-budget decision. Complete source-row JSON is never read.
 *
 * @param {{ prepare: Function }} database sql.js database.
 * @param {object} [query] Backend-neutral map-view query.
 * @returns {object} Compact exact or grouped map result.
 */
export function queryBrowserSqliteMapView(database, query = {}) {
  requireDatabase(database);
  const geometryResult = queryBrowserSqliteGeometries(database, query);
  const bounds = normalizeBounds(query.bounds);
  const renderBudget = normalizeRenderBudget(query.renderBudget);
  const datasetIds = resolveEnabledDatasetIds(database, query.datasetIds);
  const skippedPoints = sumSkippedPoints(database, datasetIds);

  if (!bounds || datasetIds.length === 0) {
    return mergeGeometryResult(
      createEmptyResult({ skippedPoints }),
      geometryResult,
    );
  }

  const filter = buildPointFilter({ bounds, datasetIds, timeline: query.timeline });
  const totalMatchingCount = countMatchingPoints(database, filter);
  const boundsOnlyCount = filter.usesTimeline
    ? countMatchingPoints(database, filter.boundsOnly)
    : totalMatchingCount;
  const skippedPointsByTimeline = Math.max(
    0,
    boundsOnlyCount - totalMatchingCount,
  );
  const overBudget = totalMatchingCount > renderBudget;
  const grid = overBudget ? getGridSpec(bounds, renderBudget) : null;
  const rows = overBudget
    ? selectGroupedPoints(database, filter, grid, renderBudget)
    : selectExactPoints(database, filter, renderBudget);
  const points = overBudget
    ? rows.map((row) => groupedRowToPoint(row, {
        bounds,
        datasetIds,
        timeline: filter.timeline,
        grid,
      }))
    : rows.map(exactRowToPoint);
  const representedCount = overBudget
    ? points.reduce((sum, point) => sum + point.count, 0)
    : points.length;

  return mergeGeometryResult({
    points,
    lines: [],
    regions: [],
    stats: {
      skippedPoints,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      skippedByTimeline: skippedPointsByTimeline,
      limitedToRenderBudget: overBudget ? renderBudget : null,
      totalMatchingCount,
      returnedCount: points.length,
      hiddenByRenderBudget: Math.max(
        0,
        totalMatchingCount - representedCount,
      ),
      overBudget,
    },
    // Dataset-wide extent is returned by getDatasetSummary; per-row entries
    // would defeat the compact viewport contract.
    timelineIndex: { entries: [] },
  }, geometryResult);
}

function mergeGeometryResult(pointResult, geometryResult) {
  const geometryStats = geometryResult.stats;
  const skippedLinesByTimeline = geometryStats.skippedLinesByTimeline;
  const skippedRegionsByTimeline = geometryStats.skippedRegionsByTimeline;
  const geometryOverLimit = geometryStats.geometryOverLimit;

  return {
    ...pointResult,
    lines: geometryResult.lines,
    regions: geometryResult.regions,
    stats: {
      ...pointResult.stats,
      skippedLines: geometryStats.skippedLines,
      skippedRegions: geometryStats.skippedRegions,
      skippedLinesByTimeline,
      skippedRegionsByTimeline,
      skippedByTimeline:
        pointResult.stats.skippedPointsByTimeline +
        skippedLinesByTimeline +
        skippedRegionsByTimeline,
      limitedToRenderBudget:
        pointResult.stats.limitedToRenderBudget ?? geometryStats.geometryLimit,
      totalMatchingCount:
        pointResult.stats.totalMatchingCount +
        geometryStats.totalMatchingGeometryCount,
      returnedCount:
        pointResult.points.length +
        geometryStats.returnedGeometryCount,
      hiddenByRenderBudget:
        pointResult.stats.hiddenByRenderBudget +
        geometryStats.hiddenGeometryCount,
      overBudget: pointResult.stats.overBudget || geometryOverLimit,
      totalMatchingLineCount: geometryStats.totalMatchingLineCount,
      totalMatchingRegionCount: geometryStats.totalMatchingRegionCount,
      returnedLineCount: geometryStats.returnedLineCount,
      returnedRegionCount: geometryStats.returnedRegionCount,
      hiddenGeometryCount: geometryStats.hiddenGeometryCount,
      geometryLimit: geometryStats.geometryLimit,
      geometryOverLimit,
    },
  };
}

function selectExactPoints(database, filter, renderBudget) {
  return readAll(database, `
    SELECT
      dataset_id,
      source_row_index,
      lat,
      lon,
      compact_json
    FROM point_features
    ${filter.sql}
    ORDER BY dataset_id, source_row_index
    LIMIT $limit
  `, { ...filter.params, $limit: renderBudget });
}

/** Return one deterministic representative for each occupied viewport cell. */
function selectGroupedPoints(database, filter, grid, renderBudget) {
  return readAll(database, `
    WITH matching AS (
      SELECT
        dataset_id,
        source_row_index,
        lat,
        lon,
        compact_json,
        CAST((lat + 90.0) / $cellHeight AS INTEGER) AS cell_lat,
        CAST((lon + 180.0) / $cellWidth AS INTEGER) AS cell_lon
      FROM point_features
      ${filter.sql}
    ),
    ranked AS (
      SELECT
        dataset_id,
        source_row_index,
        compact_json,
        cell_lat,
        cell_lon,
        COUNT(*) OVER (PARTITION BY cell_lat, cell_lon) AS group_count,
        AVG(lat) OVER (PARTITION BY cell_lat, cell_lon) AS group_lat,
        AVG(lon) OVER (PARTITION BY cell_lat, cell_lon) AS group_lon,
        ROW_NUMBER() OVER (
          PARTITION BY cell_lat, cell_lon
          ORDER BY dataset_id, source_row_index
        ) AS group_rank
      FROM matching
    )
    SELECT
      dataset_id,
      source_row_index,
      compact_json,
      cell_lat,
      cell_lon,
      group_count,
      group_lat,
      group_lon
    FROM ranked
    WHERE group_rank = 1
    ORDER BY cell_lat, cell_lon
    LIMIT $limit
  `, {
    ...filter.params,
    $cellHeight: grid.cellHeight,
    $cellWidth: grid.cellWidth,
    $limit: renderBudget,
  });
}

function exactRowToPoint(row) {
  const compact = parseJsonObject(row.compact_json);
  const datasetId = String(row.dataset_id);
  const rowIndex = normalizeCount(row.source_row_index);
  return {
    id: `${datasetId}:${rowIndex}`,
    renderType: 'exact',
    lat: Number(row.lat),
    lon: Number(row.lon),
    count: 1,
    groupId: null,
    groupRef: null,
    sourceRef: { datasetId, rowIndex },
    marker: normalizeNullableString(compact.marker),
    image: normalizeNullableString(compact.image),
    imageWidthMeters: normalizePositiveNumber(compact.imageWidthMeters),
    imageHeightMeters: normalizePositiveNumber(compact.imageHeightMeters),
    latField: normalizeNullableString(compact.latField),
    lonField: normalizeNullableString(compact.lonField),
  };
}

function groupedRowToPoint(row, context) {
  const compact = parseJsonObject(row.compact_json);
  const cellLat = normalizeInteger(row.cell_lat);
  const cellLon = normalizeInteger(row.cell_lon);
  const count = Math.max(1, normalizeCount(row.group_count));
  const groupId = `grid:${cellLat}:${cellLon}`;
  return {
    id: groupId,
    renderType: count > 1 ? 'grouped' : 'representative',
    lat: Number(row.group_lat),
    lon: Number(row.group_lon),
    count,
    groupId,
    groupRef: {
      groupId,
      bounds: {
        north: context.bounds.north,
        south: context.bounds.south,
        east: context.bounds.east,
        west: context.bounds.west,
      },
      datasetIds: [...context.datasetIds],
      timeline: context.timeline,
      grid: {
        cellLat,
        cellLon,
        cellHeight: context.grid.cellHeight,
        cellWidth: context.grid.cellWidth,
      },
      sortOrder: 'dataset-source-row',
    },
    sourceRef: null,
    marker: normalizeNullableString(compact.marker),
    image: null,
    imageWidthMeters: null,
    imageHeightMeters: null,
    latField: null,
    lonField: null,
  };
}

function buildPointFilter({ bounds, datasetIds, timeline }) {
  const datasetFilter = createDatasetFilter(datasetIds);
  const boundsClauses = [
    datasetFilter.sql,
    'lat BETWEEN $south AND $north',
    bounds.crossesAntimeridian
      ? '(lon >= $west OR lon <= $east)'
      : 'lon BETWEEN $west AND $east',
  ];
  const boundsParams = {
    ...datasetFilter.params,
    $south: bounds.south,
    $north: bounds.north,
    $west: bounds.west,
    $east: bounds.east,
  };
  const normalizedTimeline = normalizeTimeline(timeline);
  const clauses = [...boundsClauses];
  const params = { ...boundsParams };

  if (normalizedTimeline) {
    clauses.push(
      'timeline_start_year IS NOT NULL',
      'timeline_end_year IS NOT NULL',
      'timeline_start_year <= $timelineEndYear',
      'timeline_end_year >= $timelineStartYear',
    );
    params.$timelineStartYear = normalizedTimeline.startYear;
    params.$timelineEndYear = normalizedTimeline.endYear;
  }

  return {
    sql: `WHERE ${clauses.join(' AND ')}`,
    params,
    usesTimeline: normalizedTimeline != null,
    timeline: normalizedTimeline,
    boundsOnly: {
      sql: `WHERE ${boundsClauses.join(' AND ')}`,
      params: boundsParams,
    },
  };
}

function countMatchingPoints(database, filter) {
  const row = readOne(
    database,
    `SELECT COUNT(*) AS count FROM point_features ${filter.sql}`,
    filter.params,
  );
  return normalizeCount(row?.count);
}

function resolveEnabledDatasetIds(database, requestedIds) {
  const enabled = readAll(database, `
    SELECT id
    FROM datasets
    WHERE import_state = 'complete' AND enabled = 1
    ORDER BY id
  `).map((row) => String(row.id));
  if (requestedIds == null) return enabled;
  if (!Array.isArray(requestedIds)) return [];
  const requested = new Set(
    requestedIds
      .map(normalizeNullableString)
      .filter(Boolean),
  );
  return enabled.filter((id) => requested.has(id));
}

function sumSkippedPoints(database, datasetIds) {
  if (datasetIds.length === 0) return 0;
  const filter = createDatasetFilter(datasetIds, 'id');
  const row = readOne(database, `
    SELECT COALESCE(SUM(skipped_point_count), 0) AS count
    FROM datasets
    WHERE ${filter.sql}
  `, filter.params);
  return normalizeCount(row?.count);
}

function createDatasetFilter(datasetIds, column = 'dataset_id') {
  const params = {};
  const placeholders = datasetIds.map((id, index) => {
    const key = `$dataset${index}`;
    params[key] = id;
    return key;
  });
  return {
    sql: `${column} IN (${placeholders.join(', ')})`,
    params,
  };
}

/** Choose a viewport-relative grid whose occupied results fit the render budget. */
function getGridSpec(bounds, renderBudget) {
  const latSpan = Math.max(bounds.north - bounds.south, 0.000001);
  const lonSpan = Math.max(
    bounds.crossesAntimeridian
      ? 360 - bounds.west + bounds.east
      : bounds.east - bounds.west,
    0.000001,
  );
  const ratio = Math.max(lonSpan / latSpan, 0.000001);
  const columns = Math.max(1, Math.ceil(Math.sqrt(renderBudget * ratio)));
  const rows = Math.max(1, Math.ceil(renderBudget / columns));
  return {
    cellHeight: Math.max(latSpan / rows, 0.000001),
    cellWidth: Math.max(lonSpan / columns, 0.000001),
  };
}

function normalizeBounds(value) {
  if (!isRecord(value)) return null;
  const north = normalizeLatitude(value.north);
  const south = normalizeLatitude(value.south);
  const east = normalizeLongitude(value.east);
  const west = normalizeLongitude(value.west);
  if (north == null || south == null || east == null || west == null) {
    return null;
  }
  return {
    north: Math.max(north, south),
    south: Math.min(north, south),
    east,
    west,
    crossesAntimeridian: west > east,
  };
}

function normalizeTimeline(value) {
  if (!value?.timelineEnabled) return null;
  const startYear = normalizeOptionalInteger(value.startYear ?? value.yearMin);
  const endYear = normalizeOptionalInteger(value.endYear ?? value.yearMax);
  if (startYear == null || endYear == null) return null;
  return {
    timelineEnabled: true,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function normalizeRenderBudget(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_BROWSER_SQLITE_RENDER_BUDGET;
  }
  return Math.min(Math.trunc(number), MAX_BROWSER_SQLITE_RENDER_BUDGET);
}

function normalizeLatitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(-90, Math.min(90, number));
}

function normalizeLongitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= -180 && number <= 180) return number;
  return ((((number + 180) % 360) + 360) % 360) - 180;
}

function normalizeOptionalInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readOne(database, sql, parameters = {}) {
  return readAll(database, sql, parameters, 1)[0] ?? null;
}

function readAll(database, sql, parameters = {}, maximum = Infinity) {
  const statement = database.prepare(sql);
  const rows = [];
  try {
    statement.bind(parameters);
    while (rows.length < maximum && statement.step()) {
      rows.push(statement.getAsObject());
    }
    return rows;
  } finally {
    statement.free();
  }
}

function createEmptyResult({ skippedPoints = 0 } = {}) {
  return {
    points: [],
    lines: [],
    regions: [],
    stats: {
      skippedPoints,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline: 0,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      skippedByTimeline: 0,
      limitedToRenderBudget: null,
      totalMatchingCount: 0,
      returnedCount: 0,
      hiddenByRenderBudget: 0,
      overBudget: false,
    },
    timelineIndex: { entries: [] },
  };
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A sql.js database with prepare() is required.');
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
