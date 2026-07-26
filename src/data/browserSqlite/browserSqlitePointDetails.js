import { DEFAULT_GROUP_ROWS_LIMIT } from '../dataSource.js';

export const MAX_BROWSER_SQLITE_GROUP_ROWS_LIMIT = 100;
const GROUP_ROWS_SORT_ORDER = 'dataset-source-row';

/**
 * Fetch one original source row for an exact point reference.
 *
 * Full row JSON is read only for this explicit lookup, never for viewport work.
 *
 * @param {{ prepare: Function }} database sql.js database.
 * @param {{ sourceRef?: object }} [query] Exact detail request.
 * @returns {object} Normalized detail input or a defined empty result.
 */
export function getBrowserSqlitePointDetails(database, query = {}) {
  requireDatabase(database);
  const sourceRef = normalizeSourceRef(query.sourceRef);
  if (!sourceRef) return createEmptyDetailsResult();

  const row = readOne(database, `
    SELECT
      source_rows.row_json,
      datasets.coordinate_mapping_json
    FROM point_features
    INNER JOIN source_rows
      ON source_rows.dataset_id = point_features.dataset_id
      AND source_rows.source_row_index = point_features.source_row_index
    INNER JOIN datasets ON datasets.id = point_features.dataset_id
    WHERE point_features.dataset_id = ?
      AND point_features.source_row_index = ?
      AND datasets.import_state = 'complete'
    LIMIT 1
  `, [sourceRef.datasetId, sourceRef.rowIndex]);
  if (!row) return createEmptyDetailsResult();

  const mapping = parseJsonObject(row.coordinate_mapping_json);
  return {
    featureId: `${sourceRef.datasetId}:${sourceRef.rowIndex}`,
    row: parseJsonObject(row.row_json),
    latField: normalizeNullableString(mapping.latField),
    lonField: normalizeNullableString(mapping.lonField),
  };
}

/**
 * Return a stable page of source rows represented by one grouped point.
 *
 * The captured dataset set, viewport, timeline, and grid cell reproduce the
 * originating query. Removed or remapped-away points naturally disappear.
 *
 * @param {{ prepare: Function }} database sql.js database.
 * @param {{ groupRef?: object, offset?: number, limit?: number }} [query] Page request.
 * @returns {object} Bounded deterministic group page.
 */
export function getBrowserSqliteGroupRows(database, query = {}) {
  requireDatabase(database);
  const offset = normalizeOffset(query.offset);
  const limit = normalizeLimit(query.limit);
  const groupRef = normalizeGroupRef(query.groupRef);
  if (!groupRef) return createEmptyGroupRowsResult(offset, limit);

  const filter = buildGroupFilter(groupRef);
  const count = readOne(
    database,
    `SELECT COUNT(*) AS count FROM point_features ${filter.sql}`,
    filter.params,
  );
  const totalRows = normalizeNonNegativeInteger(count?.count, 0);
  const storedRows = readAll(database, `
    SELECT source_rows.row_json
    FROM point_features
    INNER JOIN source_rows
      ON source_rows.dataset_id = point_features.dataset_id
      AND source_rows.source_row_index = point_features.source_row_index
    ${filter.sql}
    ORDER BY point_features.dataset_id, point_features.source_row_index
    LIMIT $limit OFFSET $offset
  `, {
    ...filter.params,
    $limit: limit,
    $offset: offset,
  });

  return {
    rows: storedRows.map((row) => parseJsonObject(row.row_json)),
    offset,
    limit,
    totalRows,
    hasMore: offset + storedRows.length < totalRows,
  };
}

function buildGroupFilter(groupRef) {
  const datasetFilter = createDatasetFilter(groupRef.datasetIds);
  const clauses = [
    datasetFilter.sql,
    'point_features.lat BETWEEN $south AND $north',
    groupRef.bounds.west > groupRef.bounds.east
      ? '(point_features.lon >= $west OR point_features.lon <= $east)'
      : 'point_features.lon BETWEEN $west AND $east',
    `CAST(
      (point_features.lat + 90.0) / $cellHeight AS INTEGER
    ) = $cellLat`,
    `CAST(
      (point_features.lon + 180.0) / $cellWidth AS INTEGER
    ) = $cellLon`,
  ];
  const params = {
    ...datasetFilter.params,
    $north: groupRef.bounds.north,
    $south: groupRef.bounds.south,
    $east: groupRef.bounds.east,
    $west: groupRef.bounds.west,
    $cellHeight: groupRef.grid.cellHeight,
    $cellWidth: groupRef.grid.cellWidth,
    $cellLat: groupRef.grid.cellLat,
    $cellLon: groupRef.grid.cellLon,
  };

  if (groupRef.timeline) {
    clauses.push(
      'point_features.timeline_start_year IS NOT NULL',
      'point_features.timeline_end_year IS NOT NULL',
      'point_features.timeline_start_year <= $timelineEndYear',
      'point_features.timeline_end_year >= $timelineStartYear',
    );
    params.$timelineStartYear = groupRef.timeline.startYear;
    params.$timelineEndYear = groupRef.timeline.endYear;
  }

  return {
    sql: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function normalizeGroupRef(value) {
  if (!isRecord(value) || value.sortOrder !== GROUP_ROWS_SORT_ORDER) {
    return null;
  }
  const bounds = normalizeBounds(value.bounds);
  const grid = normalizeGrid(value.grid);
  const timeline = normalizeTimeline(value.timeline);
  const datasetIds = normalizeDatasetIds(value.datasetIds);
  if (!bounds || !grid || timeline === undefined || datasetIds.length === 0) {
    return null;
  }
  const groupId = `grid:${grid.cellLat}:${grid.cellLon}`;
  if (value.groupId !== groupId) return null;
  return {
    groupId,
    bounds,
    grid,
    timeline,
    datasetIds,
    sortOrder: GROUP_ROWS_SORT_ORDER,
  };
}

function normalizeSourceRef(value) {
  if (!isRecord(value)) return null;
  const datasetId = normalizeNullableString(value.datasetId);
  const rowIndex = normalizeNonNegativeInteger(value.rowIndex, null);
  return datasetId && rowIndex != null ? { datasetId, rowIndex } : null;
}

function normalizeDatasetIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeNullableString).filter(Boolean))].sort();
}

function createDatasetFilter(datasetIds) {
  const params = {};
  const placeholders = datasetIds.map((id, index) => {
    const key = `$dataset${index}`;
    params[key] = id;
    return key;
  });
  return {
    sql: `point_features.dataset_id IN (${placeholders.join(', ')})`,
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
  };
}

function normalizeGrid(value) {
  if (!isRecord(value)) return null;
  const cellLat = normalizeInteger(value.cellLat);
  const cellLon = normalizeInteger(value.cellLon);
  const cellHeight = normalizePositiveNumber(value.cellHeight);
  const cellWidth = normalizePositiveNumber(value.cellWidth);
  if (
    cellLat == null ||
    cellLon == null ||
    cellHeight == null ||
    cellWidth == null
  ) {
    return null;
  }
  return { cellLat, cellLon, cellHeight, cellWidth };
}

function normalizeTimeline(value) {
  if (!value?.timelineEnabled) return null;
  const startYear = normalizeInteger(value.startYear);
  const endYear = normalizeInteger(value.endYear);
  if (startYear == null || endYear == null) return undefined;
  return {
    timelineEnabled: true,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function normalizeOffset(value) {
  return normalizeNonNegativeInteger(value, 0);
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    return DEFAULT_GROUP_ROWS_LIMIT;
  }
  return Math.min(number, MAX_BROWSER_SQLITE_GROUP_ROWS_LIMIT);
}

function normalizeNonNegativeInteger(value, fallback) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizeInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

function readOne(database, sql, parameters = []) {
  return readAll(database, sql, parameters, 1)[0] ?? null;
}

function readAll(database, sql, parameters = [], maximum = Infinity) {
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

function createEmptyDetailsResult() {
  return { featureId: null, row: null, latField: null, lonField: null };
}

function createEmptyGroupRowsResult(offset, limit) {
  return { rows: [], offset, limit, totalRows: 0, hasMore: false };
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A sql.js database with prepare() is required.');
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
