export const DEFAULT_BROWSER_SQLITE_GEOMETRY_LIMIT = 1_000;
export const MAX_BROWSER_SQLITE_GEOMETRY_LIMIT = 10_000;

/**
 * Query compact line and region records whose bounding boxes may intersect a
 * viewport. Dataset, spatial, and inclusive timeline filters execute entirely
 * in SQLite; complete source-row JSON is never selected.
 *
 * Bounding-box false positives are intentionally retained. This conservative
 * first pass cannot miss a crossing geometry merely because every individual
 * vertex lies outside the viewport.
 *
 * @param {{ prepare: Function }} database sql.js database.
 * @param {object} [query] Backend-neutral map-view query.
 * @returns {object} Compact bounded geometry result and statistics.
 */
export function queryBrowserSqliteGeometries(database, query = {}) {
  requireDatabase(database);
  const bounds = normalizeBounds(query.bounds);
  const geometryLimit = normalizeGeometryLimit(query.renderBudget);
  const datasetIds = resolveEnabledDatasetIds(database, query.datasetIds);
  const skipped = sumSkippedGeometries(database, datasetIds);

  if (!bounds || datasetIds.length === 0) {
    return createEmptyGeometryResult(skipped);
  }

  const filter = buildGeometryFilter({
    bounds,
    datasetIds,
    timeline: query.timeline,
  });
  const matching = countMatchingGeometries(database, filter);
  const boundsOnly = filter.usesTimeline
    ? countMatchingGeometries(database, filter.boundsOnly)
    : matching;
  const rows = selectGeometries(database, filter, geometryLimit);
  const features = rows.map(storedRowToGeometry).filter(Boolean);
  const lines = features
    .filter((feature) => feature.geometryType === 'line')
    .map(removeGeometryType);
  const regions = features
    .filter((feature) => feature.geometryType === 'region')
    .map(removeGeometryType);
  const returnedGeometryCount = lines.length + regions.length;
  const totalMatchingGeometryCount = matching.lines + matching.regions;
  const hiddenGeometryCount = Math.max(
    0,
    totalMatchingGeometryCount - returnedGeometryCount,
  );

  return {
    lines,
    regions,
    stats: {
      skippedLines: skipped.lines,
      skippedRegions: skipped.regions,
      skippedLinesByTimeline: Math.max(0, boundsOnly.lines - matching.lines),
      skippedRegionsByTimeline: Math.max(
        0,
        boundsOnly.regions - matching.regions,
      ),
      totalMatchingLineCount: matching.lines,
      totalMatchingRegionCount: matching.regions,
      returnedLineCount: lines.length,
      returnedRegionCount: regions.length,
      totalMatchingGeometryCount,
      returnedGeometryCount,
      hiddenGeometryCount,
      geometryLimit: hiddenGeometryCount > 0 ? geometryLimit : null,
      geometryOverLimit: hiddenGeometryCount > 0,
    },
  };
}

/** Select complete compact coordinate sequences in deterministic source order. */
function selectGeometries(database, filter, geometryLimit) {
  return readAll(database, `
    SELECT
      geometry_features.dataset_id,
      geometry_features.geometry_type,
      geometry_features.feature_id,
      geometry_features.part,
      geometry_features.source_row_index,
      geometry_features.coordinates_json,
      geometry_features.style_json,
      geometry_features.arrow_mode,
      datasets.coordinate_mapping_json
    FROM geometry_features
    INNER JOIN datasets ON datasets.id = geometry_features.dataset_id
    ${filter.sql}
    ORDER BY
      geometry_features.dataset_id,
      geometry_features.feature_order_index,
      geometry_features.part_order_index,
      geometry_features.geometry_type,
      geometry_features.feature_id,
      geometry_features.part
    LIMIT $geometryLimit
  `, { ...filter.params, $geometryLimit: geometryLimit });
}

function storedRowToGeometry(row) {
  const datasetId = normalizeNullableString(row.dataset_id);
  const geometryType = normalizeNullableString(row.geometry_type);
  const featureId = normalizeNullableString(row.feature_id);
  const sourceRowIndex = normalizeNonNegativeInteger(row.source_row_index);
  const coordinates = parseCoordinates(row.coordinates_json);
  if (
    !datasetId ||
    !featureId ||
    sourceRowIndex == null ||
    !coordinates ||
    (geometryType !== 'line' && geometryType !== 'region')
  ) {
    return null;
  }

  const mapping = parseJsonObject(row.coordinate_mapping_json);
  const part = geometryType === 'region'
    ? normalizeNullableString(row.part) ?? '0'
    : null;
  return {
    geometryType,
    id: geometryType === 'line'
      ? `${datasetId}:${featureId}`
      : `${datasetId}:${featureId}:${part}`,
    featureId,
    ...(geometryType === 'region' ? { part } : {}),
    coordinates,
    style: parseJsonObject(row.style_json),
    ...(geometryType === 'line'
      ? { arrow: normalizeArrowMode(row.arrow_mode) }
      : {}),
    sourceRef: { datasetId, rowIndex: sourceRowIndex },
    latField: normalizeNullableString(mapping.latField),
    lonField: normalizeNullableString(mapping.lonField),
  };
}

function removeGeometryType(feature) {
  const { geometryType: _geometryType, ...normalized } = feature;
  return normalized;
}

/** Build conservative viewport and timeline overlap clauses. */
function buildGeometryFilter({ bounds, datasetIds, timeline }) {
  const datasetFilter = createDatasetFilter(datasetIds);
  const boundsClauses = [
    datasetFilter.sql,
    'geometry_features.max_lat >= $south',
    'geometry_features.min_lat <= $north',
    bounds.crossesAntimeridian
      ? '('
        + 'geometry_features.max_lon >= $west '
        + 'OR geometry_features.min_lon <= $east'
        + ')'
      : 'geometry_features.max_lon >= $west '
        + 'AND geometry_features.min_lon <= $east',
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
      'geometry_features.timeline_start_year IS NOT NULL',
      'geometry_features.timeline_end_year IS NOT NULL',
      'geometry_features.timeline_start_year <= $timelineEndYear',
      'geometry_features.timeline_end_year >= $timelineStartYear',
    );
    params.$timelineStartYear = normalizedTimeline.startYear;
    params.$timelineEndYear = normalizedTimeline.endYear;
  }

  return {
    sql: `WHERE ${clauses.join(' AND ')}`,
    params,
    usesTimeline: normalizedTimeline != null,
    boundsOnly: {
      sql: `WHERE ${boundsClauses.join(' AND ')}`,
      params: boundsParams,
    },
  };
}

function countMatchingGeometries(database, filter) {
  const rows = readAll(database, `
    SELECT
      geometry_features.geometry_type,
      COUNT(*) AS count
    FROM geometry_features
    INNER JOIN datasets ON datasets.id = geometry_features.dataset_id
    ${filter.sql}
    GROUP BY geometry_features.geometry_type
  `, filter.params);
  const result = { lines: 0, regions: 0 };
  for (const row of rows) {
    if (row.geometry_type === 'line') {
      result.lines = normalizeCount(row.count);
    } else if (row.geometry_type === 'region') {
      result.regions = normalizeCount(row.count);
    }
  }
  return result;
}

function sumSkippedGeometries(database, datasetIds) {
  if (datasetIds.length === 0) return { lines: 0, regions: 0 };
  const filter = createDatasetFilter(datasetIds, 'id');
  const row = readAll(database, `
    SELECT
      COALESCE(SUM(skipped_line_count), 0) AS skipped_lines,
      COALESCE(SUM(skipped_region_count), 0) AS skipped_regions
    FROM datasets
    WHERE ${filter.sql}
  `, filter.params, 1)[0];
  return {
    lines: normalizeCount(row?.skipped_lines),
    regions: normalizeCount(row?.skipped_regions),
  };
}

function resolveEnabledDatasetIds(database, requestedIds) {
  const rows = readAll(database, `
    SELECT id
    FROM datasets
    WHERE enabled = 1 AND import_state = 'complete'
    ORDER BY id
  `);
  const enabled = rows.map((row) => String(row.id));
  if (requestedIds == null) return enabled;
  if (!Array.isArray(requestedIds)) return [];
  const requested = new Set(
    requestedIds.map(normalizeNullableString).filter(Boolean),
  );
  return enabled.filter((id) => requested.has(id));
}

function createDatasetFilter(datasetIds, column = 'geometry_features.dataset_id') {
  const params = {};
  const placeholders = datasetIds.map((datasetId, index) => {
    const key = `$dataset${index}`;
    params[key] = datasetId;
    return key;
  });
  return {
    sql: `${column} IN (${placeholders.join(', ')})`,
    params,
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
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function normalizeGeometryLimit(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    return DEFAULT_BROWSER_SQLITE_GEOMETRY_LIMIT;
  }
  return Math.min(number, MAX_BROWSER_SQLITE_GEOMETRY_LIMIT);
}

function normalizeLatitude(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= -90 && number <= 90
    ? number
    : null;
}

function normalizeLongitude(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= -180 && number <= 180
    ? number
    : null;
}

function normalizeOptionalInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeCount(value) {
  return normalizeNonNegativeInteger(value) ?? 0;
}

function normalizeArrowMode(value) {
  return ['none', 'start', 'end', 'both'].includes(value) ? value : 'none';
}

function parseCoordinates(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    if (!Array.isArray(parsed)) return null;
    const coordinates = parsed.map((coordinate) => (
      Array.isArray(coordinate) && coordinate.length >= 2
        ? [Number(coordinate[0]), Number(coordinate[1])]
        : null
    ));
    return coordinates.every((coordinate) => (
      coordinate &&
      Number.isFinite(coordinate[0]) &&
      Number.isFinite(coordinate[1])
    )) ? coordinates : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function readAll(database, sql, parameters = {}, maximumRows = Infinity) {
  const statement = database.prepare(sql);
  const rows = [];
  try {
    statement.bind(parameters);
    while (rows.length < maximumRows && statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

function createEmptyGeometryResult(skipped) {
  return {
    lines: [],
    regions: [],
    stats: {
      skippedLines: skipped.lines,
      skippedRegions: skipped.regions,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      totalMatchingLineCount: 0,
      totalMatchingRegionCount: 0,
      returnedLineCount: 0,
      returnedRegionCount: 0,
      totalMatchingGeometryCount: 0,
      returnedGeometryCount: 0,
      hiddenGeometryCount: 0,
      geometryLimit: null,
      geometryOverLimit: false,
    },
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
