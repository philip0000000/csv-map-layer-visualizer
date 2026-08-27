"use strict";

const DEFAULT_RENDER_BUDGET = 1000;
const MAX_RENDER_BUDGET = 10000;
const DEFAULT_IMAGE_SIZE_METERS = 100;
const MIN_IMAGE_SIZE_METERS = 1;
const MAX_IMAGE_SIZE_METERS = 100000;

/**
 * Query compact point and region render data from the desktop SQLite store.
 * This intentionally avoids row_json; full details use a separate lookup path.
 */
function querySqliteMapView({ db, bounds, timeline = null, renderBudget = DEFAULT_RENDER_BUDGET }) {
  if (!db?.open) {
    throw new TypeError("An open SQLite database is required.");
  }

  const normalizedBounds = normalizeBounds(bounds);
  const budget = normalizeRenderBudget(renderBudget);

  if (!normalizedBounds) {
    return createEmptyMapViewResult({
      limitedToRenderBudget: null,
      totalMatchingCount: 0,
      skippedPointsByTimeline: 0,
    });
  }

  const filter = buildWhereClause({ bounds: normalizedBounds, timeline });
  // Count first so the UI can explain how many matching datapoints are hidden by the render budget.
  const totalMatchingCount = countMatchingFeatures(db, filter);
  const boundsOnlyCount = filter.usesTimeline ? countMatchingFeatures(db, filter.boundsOnly) : totalMatchingCount;
  const skippedPointsByTimeline = Math.max(0, boundsOnlyCount - totalMatchingCount);
  const overBudget = totalMatchingCount > budget;
  // Save the same grid used for rendering so detail paging can reproduce each group.
  const groupGrid = overBudget ? getGridSpec(normalizedBounds, budget) : null;
  const groupedDatasetIds = overBudget ? selectEnabledDatasetIds(db) : null;
  // Under budget stays exact; over budget switches to compact render summaries.
  const rows = overBudget
    ? selectGroupedFeatures(db, filter, groupGrid)
    : selectMatchingFeatures(db, filter, budget);
  const points = overBudget
    ? rows.map((row) => rowToGroupedPointFeature(row, {
      bounds: normalizedBounds,
      datasetIds: groupedDatasetIds,
      timeline: filter.timeline,
      grid: groupGrid,
    }))
    : rows.map(rowToPointFeature);
  const returnedCount = points.length;
  const representedCount = overBudget
    ? points.reduce((sum, point) => sum + normalizeCount(point.count), 0)
    : returnedCount;
  const hiddenByRenderBudget = Math.max(0, totalMatchingCount - representedCount);
  const regionResult = queryMatchingRegions(db, normalizedBounds, timeline, budget);

  return {
    points,
    lines: [],
    regions: regionResult.regions,
    stats: {
      skippedPoints: 0,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: regionResult.skippedByTimeline,
      skippedByTimeline: skippedPointsByTimeline + regionResult.skippedByTimeline,
      limitedToRenderBudget: overBudget ? budget : null,
      totalMatchingCount,
      returnedCount,
      hiddenByRenderBudget,
      overBudget,
      totalMatchingRegionCount: regionResult.totalMatchingCount,
      returnedRegionCount: regionResult.regions.length,
      hiddenGeometryCount: Math.max(0, regionResult.totalMatchingCount - regionResult.regions.length),
      geometryLimit: regionResult.totalMatchingCount > regionResult.regions.length ? budget : null,
      geometryOverLimit: regionResult.totalMatchingCount > regionResult.regions.length,
    },
    timelineIndex: {
      entries: [],
    },
  };
}

function countMatchingFeatures(db, filter) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM features ${filter.sql}`).get(filter.params);
  return normalizeCount(row?.count);
}

/** Query compact persistent regions with the same visibility and timeline rules as points. */
function queryMatchingRegions(db, bounds, timeline, renderBudget) {
  const timelineFilter = buildTimelineFilter(timeline);
  const boundsClauses = [
    "dataset_id IN (SELECT id FROM datasets WHERE enabled = 1)",
    "max_lat >= @south",
    "min_lat <= @north",
    bounds.crossesAntimeridian
      ? "(max_lon >= @west OR min_lon <= @east)"
      : "max_lon >= @west AND min_lon <= @east",
  ];
  const params = {
    north: bounds.north,
    south: bounds.south,
    east: bounds.east,
    west: bounds.west,
    ...timelineFilter.params,
  };
  const clauses = [...boundsClauses, ...timelineFilter.clauses];
  const count = (whereClauses, whereParams) => normalizeCount(db.prepare(`
    SELECT COUNT(*) AS count FROM geometry_features
    WHERE ${whereClauses.join(" AND ")}
  `).get(whereParams)?.count);
  const totalMatchingCount = count(clauses, params);
  const boundsOnlyCount = timelineFilter.usesTimeline
    ? count(boundsClauses, params)
    : totalMatchingCount;
  const rows = db.prepare(`
    SELECT dataset_id, feature_id, part, source_row_index,
           coordinates_json, style_json
    FROM geometry_features
    WHERE ${clauses.join(" AND ")}
    ORDER BY dataset_id, part_order_index, feature_id, part
    LIMIT @limit
  `).all({ ...params, limit: renderBudget });
  return {
    totalMatchingCount,
    skippedByTimeline: Math.max(0, boundsOnlyCount - totalMatchingCount),
    regions: rows.map((row) => ({
      id: `${row.dataset_id}:${row.feature_id}:${row.part}`,
      featureId: String(row.feature_id),
      part: String(row.part),
      coordinates: parseCoordinates(row.coordinates_json),
      style: parseCompactFields(row.style_json),
      sourceRef: {
        datasetId: String(row.dataset_id),
        rowIndex: normalizeCount(row.source_row_index),
      },
    })),
  };
}

function selectMatchingFeatures(db, filter, renderBudget) {
  return db.prepare(`
    SELECT
      id,
      dataset_id,
      source_row_index,
      lat,
      lon,
      timeline_start_year,
      timeline_end_year,
      compact_json
    FROM features
    ${filter.sql}
    -- Keep the query order stable when the render budget hides part of the result set.
    ORDER BY dataset_id, source_row_index
    LIMIT @limit
  `).all({
    ...filter.params,
    limit: renderBudget,
  });
}

/**
 * Return one compact render item per occupied grid cell for dense viewport results.
 * Reuses the already-built bounds/timeline filter so grouping happens after filtering.
 */
function selectGroupedFeatures(db, filter, grid) {
  return db.prepare(`
    WITH matching AS (
      SELECT
        id,
        dataset_id,
        source_row_index,
        lat,
        lon,
        compact_json,
        CASE
          WHEN @crossesAntimeridian = 1 AND lon < @west
            THEN lon + 360.0
          ELSE lon
        END AS grouping_lon,
        -- Viewport-relative, clamped ids guarantee at most rows * columns cells.
        MIN(@lastCellLat, MAX(0,
          CAST((lat - @south) / @cellHeight AS INTEGER)
        )) AS cell_lat,
        MIN(@lastCellLon, MAX(0, CAST((
          CASE
            WHEN @crossesAntimeridian = 1 AND lon < @west
              THEN lon + 360.0 - @west
            ELSE lon - @west
          END
        ) / @cellWidth AS INTEGER))) AS cell_lon
      FROM features
      ${filter.sql}
    ),
    ranked AS (
      SELECT
        id,
        dataset_id,
        source_row_index,
        compact_json,
        cell_lat,
        cell_lon,
        COUNT(*) OVER (PARTITION BY cell_lat, cell_lon) AS group_count,
        AVG(lat) OVER (PARTITION BY cell_lat, cell_lon) AS group_lat,
        AVG(grouping_lon) OVER (PARTITION BY cell_lat, cell_lon) AS group_lon,
        -- Southern markers render higher in Leaflet's z-order; later source rows break ties.
        ROW_NUMBER() OVER (
          PARTITION BY cell_lat, cell_lon
          ORDER BY lat ASC, dataset_id DESC, source_row_index DESC
        ) AS group_rank
      FROM matching
    )
    SELECT
      id,
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
  `).all({
    ...filter.params,
    cellHeight: grid.cellHeight,
    cellWidth: grid.cellWidth,
    lastCellLat: grid.rows - 1,
    lastCellLon: grid.columns - 1,
    crossesAntimeridian: filter.params.west > filter.params.east ? 1 : 0,
  });
}

/** Capture the enabled dataset identities used by a grouped viewport query. */
function selectEnabledDatasetIds(db) {
  return db.prepare(`
    SELECT id
    FROM datasets
    WHERE enabled = 1
    ORDER BY id
  `).all().map((row) => String(row.id));
}

/**
 * Choose a viewport-relative grid whose maximum possible cell count fits the budget.
 * Floor the row count so grouped results never need a truncating SQL LIMIT.
 */
function getGridSpec(bounds, renderBudget) {
  const latSpan = Math.max(bounds.north - bounds.south, 0.000001);
  const lonSpan = Math.max(
    bounds.crossesAntimeridian
      ? 360 - bounds.west + bounds.east
      : bounds.east - bounds.west,
    0.000001,
  );
  const targetCells = Math.max(1, renderBudget);
  const ratio = Math.max(lonSpan / latSpan, 0.000001);
  const columns = Math.max(
    1,
    Math.min(targetCells, Math.ceil(Math.sqrt(targetCells * ratio))),
  );
  const rows = Math.max(1, Math.floor(targetCells / columns));

  return {
    rows,
    columns,
    cellHeight: Math.max(latSpan / rows, 0.000001),
    cellWidth: Math.max(lonSpan / columns, 0.000001),
  };
}

function buildWhereClause({ bounds, timeline }) {
  const boundsFilter = buildBoundsFilter(bounds);
  const timelineFilter = buildTimelineFilter(timeline);
  const clauses = [...boundsFilter.clauses, ...timelineFilter.clauses];
  const params = {
    ...boundsFilter.params,
    ...timelineFilter.params,
  };

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    usesTimeline: timelineFilter.usesTimeline,
    timeline: timelineFilter.timeline,
    // Build the bounds-only filter once so skipped-by-timeline can stay cheap and consistent.
    boundsOnly: {
      sql: boundsFilter.clauses.length > 0 ? `WHERE ${boundsFilter.clauses.join(" AND ")}` : "",
      params: boundsFilter.params,
    },
  };
}

function buildBoundsFilter(bounds) {
  const clauses = [
    "dataset_id IN (SELECT id FROM datasets WHERE enabled = 1)",
    // Region vertices now render from geometry_features; retain every other existing point-row behavior.
    "COALESCE(LOWER(TRIM(json_extract(compact_json, '$.featureType'))), 'point') <> 'region'",
    "lat BETWEEN @south AND @north",
  ];
  const params = {
    north: bounds.north,
    south: bounds.south,
    east: bounds.east,
    west: bounds.west,
  };

  // Leaflet can report wrapped viewports where west is greater than east.
  if (bounds.crossesAntimeridian) {
    clauses.push("(lon >= @west OR lon <= @east)");
  } else {
    clauses.push("lon BETWEEN @west AND @east");
  }

  return { clauses, params };
}

function buildTimelineFilter(timeline) {
  if (!timeline?.timelineEnabled) {
    return { clauses: [], params: {}, usesTimeline: false, timeline: null };
  }

  const startYear = normalizeYear(timeline.startYear);
  const endYear = normalizeYear(timeline.endYear);

  if (startYear == null || endYear == null) {
    return { clauses: [], params: {}, usesTimeline: false, timeline: null };
  }

  return {
    // Range overlap keeps multi-year rows visible when any part intersects the selected timeline.
    clauses: [
      "timeline_start_year IS NOT NULL",
      "timeline_end_year IS NOT NULL",
      "timeline_start_year <= @timelineEndYear",
      "timeline_end_year >= @timelineStartYear",
    ],
    params: {
      timelineStartYear: Math.min(startYear, endYear),
      timelineEndYear: Math.max(startYear, endYear),
    },
    usesTimeline: true,
    timeline: {
      timelineEnabled: true,
      startYear: Math.min(startYear, endYear),
      endYear: Math.max(startYear, endYear),
    },
  };
}

function rowToPointFeature(row) {
  const compactFields = parseCompactFields(row.compact_json);

  return {
    id: String(row.id),
    renderType: "exact",
    lat: Number(row.lat),
    lon: Number(row.lon),
    count: 1,
    groupId: null,
    sourceRef: {
      datasetId: String(row.dataset_id),
      rowIndex: normalizeCount(row.source_row_index),
    },
    // Keep legacy refs available while the map popup code is still being migrated.
    sourceFileId: String(row.dataset_id),
    sourceRowIndex: normalizeCount(row.source_row_index),
    marker: getNullableString(compactFields.marker),
    image: getNullableString(compactFields.image),
    imageWidthMeters: normalizeImageSizeMeters(compactFields.imageWidthMeters),
    imageHeightMeters: normalizeImageSizeMeters(compactFields.imageHeightMeters),
    latField: getNullableString(compactFields.latField),
    lonField: getNullableString(compactFields.lonField),
    compactFields,
  };
}

/**
 * Convert one grouped SQL row into compact map render data only.
 * Full rows stay out of render results; groupRef supports separate paged lookup.
 */
function rowToGroupedPointFeature(row, { bounds, datasetIds, timeline, grid }) {
  const compactFields = parseCompactFields(row.compact_json);
  const count = Math.max(1, normalizeCount(row.group_count));
  const groupId = `grid:${row.cell_lat}:${row.cell_lon}`;

  return {
    id: groupId,
    renderType: count > 1 ? "grouped" : "representative",
    lat: Number(row.group_lat),
    lon: normalizeLongitude(row.group_lon) ?? Number(row.group_lon),
    count,
    groupId,
    // Capture the originating query so later paging cannot drift with current UI state.
    groupRef: {
      groupId,
      bounds: {
        north: bounds.north,
        south: bounds.south,
        east: bounds.east,
        west: bounds.west,
      },
      datasetIds: [...datasetIds],
      timeline,
      grid: {
        cellLat: normalizeCount(row.cell_lat),
        cellLon: normalizeCount(row.cell_lon),
        cellHeight: grid.cellHeight,
        cellWidth: grid.cellWidth,
      },
      sortOrder: 'dataset-source-row',
    },
    sourceRef: null,
    marker: getNullableString(compactFields.marker),
    image: null,
    imageWidthMeters: null,
    imageHeightMeters: null,
    latField: null,
    lonField: null,
  };
}

function parseCompactFields(value) {
  if (!value || typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseCoordinates(value) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Normalize Leaflet bounds without collapsing a viewport spanning a full world. */
function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;

  const north = normalizeLatitude(bounds.north);
  const south = normalizeLatitude(bounds.south);
  const rawEast = Number(bounds.east);
  const rawWest = Number(bounds.west);

  if (
    north == null ||
    south == null ||
    !Number.isFinite(rawEast) ||
    !Number.isFinite(rawWest)
  ) {
    return null;
  }

  // At low zoom Leaflet can expose more than one wrapped copy of the world.
  // Normalizing those endpoints separately would collapse the viewport into
  // a moving longitude slice, making markers appear stuck to one side.
  const coversWholeWorld = rawEast >= rawWest && rawEast - rawWest >= 360;
  const east = coversWholeWorld ? 180 : normalizeLongitude(rawEast);
  const west = coversWholeWorld ? -180 : normalizeLongitude(rawWest);

  return {
    north: Math.max(north, south),
    south: Math.min(north, south),
    east,
    west,
    crossesAntimeridian: west > east,
  };
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

function normalizeImageSizeMeters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_IMAGE_SIZE_METERS;
  return Math.min(MAX_IMAGE_SIZE_METERS, Math.max(MIN_IMAGE_SIZE_METERS, number));
}

function normalizeRenderBudget(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_RENDER_BUDGET;
  return Math.min(number, MAX_RENDER_BUDGET);
}

function normalizeYear(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  return Math.trunc(number);
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getNullableString(value) {
  if (value === null || value === undefined) return null;

  const stringValue = String(value);
  return stringValue.trim() ? stringValue : null;
}

function createEmptyMapViewResult({
  limitedToRenderBudget,
  totalMatchingCount,
  skippedPointsByTimeline,
}) {
  return {
    points: [],
    lines: [],
    regions: [],
    stats: {
      skippedPoints: 0,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      skippedByTimeline: skippedPointsByTimeline,
      limitedToRenderBudget,
      totalMatchingCount,
      returnedCount: 0,
      hiddenByRenderBudget: 0,
      overBudget: false,
    },
    timelineIndex: {
      entries: [],
    },
  };
}

module.exports = {
  DEFAULT_RENDER_BUDGET,
  querySqliteMapView,
};
