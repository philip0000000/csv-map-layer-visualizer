'use strict';

const DEFAULT_GROUP_ROWS_LIMIT = 30;
const MAX_GROUP_ROWS_LIMIT = 100;
const GROUP_ROWS_SORT_ORDER = 'dataset-source-row';

/**
 * Fetch the stored CSV row for one exact SQLite-backed marker.
 */
function getSqliteFeatureDetails({ db, sourceRef } = {}) {
  assertOpenDatabase(db);

  // Use the stored dataset and row position instead of a temporary map render ID.
  const normalizedSourceRef = normalizeSourceRef(sourceRef);
  if (!normalizedSourceRef) {
    return createEmptyFeatureDetailsResult();
  }

  const storedFeature = db.prepare([
    'SELECT id, compact_json, row_json',
    'FROM features',
    'WHERE dataset_id = @datasetId',
    '  AND source_row_index = @rowIndex',
    'LIMIT 1',
  ].join('\n')).get(normalizedSourceRef);

  if (!storedFeature) {
    return createEmptyFeatureDetailsResult();
  }

  // Read the full CSV row only after the user asks to see marker details.
  const compactFields = parseJsonObject(storedFeature.compact_json, {});

  return {
    featureId: String(storedFeature.id),
    row: parseJsonObject(storedFeature.row_json, null),
    latField: getNullableString(compactFields.latField),
    lonField: getNullableString(compactFields.lonField),
  };
}

/**
 * Fetch one deterministic page of rows represented by a grouped marker.
 */
function getSqliteGroupRows({
  db,
  groupRef,
  offset = 0,
  limit = DEFAULT_GROUP_ROWS_LIMIT,
} = {}) {
  assertOpenDatabase(db);

  const normalizedOffset = normalizeOffset(offset);
  const normalizedLimit = normalizeLimit(limit);
  const normalizedGroupRef = normalizeGroupRef(groupRef);

  if (!normalizedGroupRef) {
    return createEmptyGroupRowsResult(normalizedOffset, normalizedLimit);
  }

  // The count and page must use the same filter so the paging total stays correct.
  const filter = buildGroupWhereClause(normalizedGroupRef);
  const countRow = db.prepare([
    'SELECT COUNT(*) AS count',
    'FROM features',
    filter.sql,
  ].join('\n')).get(filter.params);
  const totalRows = normalizeNonNegativeInteger(countRow?.count, 0);
  const storedRows = db.prepare([
    'SELECT row_json',
    'FROM features',
    filter.sql,
    // A stable order prevents rows from moving between pages.
    'ORDER BY dataset_id, source_row_index',
    'LIMIT @limit',
    'OFFSET @offset',
  ].join('\n')).all({
    ...filter.params,
    limit: normalizedLimit,
    offset: normalizedOffset,
  });

  return {
    rows: storedRows.map((storedRow) => parseJsonObject(storedRow.row_json, {})),
    offset: normalizedOffset,
    limit: normalizedLimit,
    totalRows,
  };
}

function buildGroupWhereClause(groupRef) {
  const { bounds, grid, timeline } = groupRef;
  // Rebuild the original point group from its viewport, grid cell, and timeline.
  const clauses = [
    'dataset_id IN (SELECT id FROM datasets WHERE enabled = 1)',
    // Region vertices render as polygons and therefore cannot belong to a point marker.
    "COALESCE(LOWER(TRIM(json_extract(compact_json, '$.featureType'))), 'point') <> 'region'",
    'lat BETWEEN @south AND @north',
    bounds.west > bounds.east
      ? '(lon >= @west OR lon <= @east)'
      : 'lon BETWEEN @west AND @east',
    'CAST((lat + 90.0) / @cellHeight AS INTEGER) = @cellLat',
    'CAST((lon + 180.0) / @cellWidth AS INTEGER) = @cellLon',
  ];
  const params = {
    north: bounds.north,
    south: bounds.south,
    east: bounds.east,
    west: bounds.west,
    cellLat: grid.cellLat,
    cellLon: grid.cellLon,
    cellHeight: grid.cellHeight,
    cellWidth: grid.cellWidth,
  };

  if (timeline) {
    clauses.push(
      'timeline_start_year IS NOT NULL',
      'timeline_end_year IS NOT NULL',
      'timeline_start_year <= @timelineEndYear',
      'timeline_end_year >= @timelineStartYear',
    );
    params.timelineStartYear = timeline.startYear;
    params.timelineEndYear = timeline.endYear;
  }

  return {
    sql: 'WHERE ' + clauses.join(' AND '),
    params,
  };
}

function normalizeGroupRef(groupRef) {
  if (!groupRef || typeof groupRef !== 'object') return null;

  const bounds = normalizeBounds(groupRef.bounds);
  const grid = normalizeGridRef(groupRef.grid);
  const timeline = normalizeTimeline(groupRef.timeline);

  if (!bounds || !grid || timeline === undefined) return null;
  if (groupRef.sortOrder !== GROUP_ROWS_SORT_ORDER) return null;

  // Reject mismatched IDs instead of accidentally running a wider query.
  const expectedGroupId = ['grid', grid.cellLat, grid.cellLon].join(':');
  if (groupRef.groupId !== expectedGroupId) return null;

  return {
    groupId: expectedGroupId,
    bounds,
    grid,
    timeline,
    sortOrder: GROUP_ROWS_SORT_ORDER,
  };
}

function normalizeSourceRef(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'object') return null;

  const datasetId = getNullableString(sourceRef.datasetId);
  const rowIndex = normalizeNonNegativeInteger(sourceRef.rowIndex, null);

  if (!datasetId || rowIndex == null) return null;
  return { datasetId, rowIndex };
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;

  const north = normalizeLatitude(bounds.north);
  const south = normalizeLatitude(bounds.south);
  const east = normalizeLongitude(bounds.east);
  const west = normalizeLongitude(bounds.west);

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

function normalizeGridRef(grid) {
  if (!grid || typeof grid !== 'object') return null;

  const cellLat = normalizeInteger(grid.cellLat);
  const cellLon = normalizeInteger(grid.cellLon);
  const cellHeight = normalizePositiveNumber(grid.cellHeight);
  const cellWidth = normalizePositiveNumber(grid.cellWidth);

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

function normalizeTimeline(timeline) {
  if (!timeline?.timelineEnabled) return null;

  const startYear = normalizeInteger(timeline.startYear);
  const endYear = normalizeInteger(timeline.endYear);
  if (startYear == null || endYear == null) return undefined;

  return {
    timelineEnabled: true,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function normalizeLatitude(value) {
  if (isBlankValue(value)) return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(-90, Math.min(90, number));
}

function normalizeLongitude(value) {
  if (isBlankValue(value)) return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= -180 && number <= 180) return number;
  return ((((number + 180) % 360) + 360) % 360) - 180;
}

function normalizeInteger(value) {
  if (isBlankValue(value)) return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function normalizeOffset(value) {
  return normalizeNonNegativeInteger(value, 0);
}

function normalizeLimit(value) {
  const normalized = normalizeNonNegativeInteger(value, DEFAULT_GROUP_ROWS_LIMIT);
  if (normalized <= 0) return DEFAULT_GROUP_ROWS_LIMIT;
  return Math.min(normalized, MAX_GROUP_ROWS_LIMIT);
}

function normalizeNonNegativeInteger(value, fallback) {
  if (isBlankValue(value)) return fallback;

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.trunc(number);
}

function isBlankValue(value) {
  return value === null || value === undefined || value === '';
}

function parseJsonObject(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

function getNullableString(value) {
  if (value === null || value === undefined) return null;

  const stringValue = String(value);
  return stringValue.trim() ? stringValue : null;
}

function assertOpenDatabase(db) {
  if (!db?.open) {
    throw new TypeError('An open SQLite database is required.');
  }
}

function createEmptyFeatureDetailsResult() {
  return {
    featureId: null,
    row: null,
    latField: null,
    lonField: null,
  };
}

function createEmptyGroupRowsResult(offset, limit) {
  return {
    rows: [],
    offset,
    limit,
    totalRows: 0,
  };
}

module.exports = {
  DEFAULT_GROUP_ROWS_LIMIT,
  GROUP_ROWS_SORT_ORDER,
  MAX_GROUP_ROWS_LIMIT,
  getSqliteFeatureDetails,
  getSqliteGroupRows,
};
