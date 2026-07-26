import {
  BACKEND_FAILURE_CATEGORIES,
  DATA_SOURCE_METHODS,
  DEFAULT_GROUP_ROWS_LIMIT,
  DEFAULT_PREVIEW_ROWS_LIMIT,
} from './dataSource.js';

const FAILURE_CATEGORIES = new Set(Object.values(BACKEND_FAILURE_CATEGORIES));
const OPERATIONS = new Set(Object.values(DATA_SOURCE_METHODS));
const IMPORT_PROGRESS_STATES = new Set([
  'queued',
  'started',
  'parsing',
  'storing',
  'completed',
]);
const POINT_RENDER_TYPES = new Set(['exact', 'grouped', 'representative']);
const LINE_ARROW_MODES = new Set(['none', 'start', 'end', 'both']);
const STYLE_KEYS = new Set([
  'color',
  'weight',
  'opacity',
  'fillColor',
  'fillOpacity',
  'dashArray',
  'lineCap',
  'lineJoin',
]);
const MAX_STRING_LIST_ITEMS = 200;

const CAPABILITY_KEYS = [
  'browserFileImport',
  'nativeFilePickerImport',
  'droppedFileImport',
  'exampleImport',
  'multipleFileImport',
  'importProgress',
  'importCancellation',
  'datasetSelection',
  'datasetVisibility',
  'datasetRemoval',
  'datasetMapping',
  'previewPaging',
  'points',
  'lines',
  'regions',
  'groupedViewportResults',
];

/**
 * Build a stable failure without copying raw runtime error details.
 */
export function normalizeBackendFailure(_rawError, defaults = {}) {
  const category = FAILURE_CATEGORIES.has(defaults.category)
    ? defaults.category
    : BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE;
  const operation = OPERATIONS.has(defaults.operation)
    ? defaults.operation
    : 'unknown';

  return {
    category,
    message: normalizeSafeMessage(defaults.message),
    operation,
    recoverable: defaults.recoverable === true,
    datasetId: normalizeNullableId(defaults.datasetId),
    importId: normalizeNullableId(defaults.importId),
  };
}

/** Normalize and freeze immutable capability facts. */
export function normalizeBackendCapabilities(value) {
  const source = isRecord(value) ? value : {};
  const capabilities = {
    persistence: source.persistence === 'persistent' ? 'persistent' : 'temporary',
  };

  for (const key of CAPABILITY_KEYS) {
    capabilities[key] = source[key] === true;
  }

  return Object.freeze(capabilities);
}

/** Normalize backend initialization without trusting runtime error messages. */
export function normalizeInitializationResult(value) {
  const source = isRecord(value) ? value : {};
  const ok = source.ok === true;

  return {
    ok,
    capabilities: normalizeBackendCapabilities(source.capabilities),
    error: ok
      ? null
      : normalizeBackendFailure(source.error, {
          category: BACKEND_FAILURE_CATEGORIES.INITIALIZATION_FAILED,
          operation: DATA_SOURCE_METHODS.initialize,
          message: 'The data backend could not be initialized.',
          recoverable: true,
        }),
  };
}

/** Normalize a progress event; malformed events are ignored as null. */
export function normalizeImportProgress(value) {
  if (!isRecord(value) || !IMPORT_PROGRESS_STATES.has(value.state)) return null;

  const importId = normalizeNullableId(value.importId);
  const fileName = normalizeDisplayName(value.fileName);
  const fileNumber = normalizePositiveInteger(value.fileNumber, null);
  const totalFiles = normalizePositiveInteger(value.totalFiles, null);
  if (!importId || !fileName || !fileNumber || !totalFiles || fileNumber > totalFiles) {
    return null;
  }

  return {
    importId,
    state: value.state,
    fileName,
    fileNumber,
    totalFiles,
    completedRows: normalizeOptionalNonNegativeInteger(value.completedRows),
    totalRows: normalizeOptionalNonNegativeInteger(value.totalRows),
    ok: value.state === 'completed' ? value.ok === true : null,
  };
}

/** Normalize independent file results and derive trustworthy batch counts. */
export function normalizeImportBatchResult(value, context = {}) {
  const source = isRecord(value) ? value : {};
  const operation = OPERATIONS.has(context.operation)
    ? context.operation
    : DATA_SOURCE_METHODS.importBrowserFiles;
  const results = Array.isArray(source.results)
    ? source.results
        .map((item) => normalizeImportFileResult(item, { operation }))
        .filter(Boolean)
    : [];
  const successfulCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - successfulCount;
  const canceled = source.canceled === true;
  const ok = !canceled && successfulCount > 0;

  return {
    ok,
    importId: normalizeNullableId(source.importId),
    canceled,
    successfulCount,
    failedCount,
    results,
    error: ok
      ? null
      : normalizeBackendFailure(source.error, {
          category: canceled
            ? BACKEND_FAILURE_CATEGORIES.IMPORT_CANCELED
            : FAILURE_CATEGORIES.has(context.category)
              ? context.category
              : BACKEND_FAILURE_CATEGORIES.IMPORT_FAILED,
          operation,
          message: canceled
            ? 'Import canceled.'
            : context.message ?? 'No CSV files were imported.',
          recoverable: true,
          importId: source.importId,
        }),
  };
}

/** Normalize one import result without exposing a source path. */
export function normalizeImportFileResult(value, context = {}) {
  if (!isRecord(value)) return null;

  const fileName = normalizeDisplayName(value.fileName);
  if (!fileName) return null;
  const ok = value.ok === true;

  return {
    ok,
    fileName,
    datasetId: normalizeNullableId(value.datasetId),
    rowCount: normalizeNonNegativeInteger(value.rowCount),
    importedFeatureCount: normalizeNonNegativeInteger(value.importedFeatureCount),
    skippedRowCount: normalizeNonNegativeInteger(value.skippedRowCount),
    warnings: normalizeStringList(
      value.warnings ?? value.parseErrors,
      MAX_STRING_LIST_ITEMS,
    ),
    detectedFields: normalizeDetectedFields(value.detectedFields),
    error: ok
      ? null
      : normalizeBackendFailure(value.error, {
          category: BACKEND_FAILURE_CATEGORIES.IMPORT_FAILED,
          operation: OPERATIONS.has(context.operation)
            ? context.operation
            : DATA_SOURCE_METHODS.importBrowserFiles,
          message: 'The CSV file could not be imported.',
          recoverable: true,
          datasetId: value.datasetId,
        }),
  };
}

/** Normalize an import cancellation acknowledgement. */
export function normalizeImportCancellationResult(value, importId) {
  const source = isRecord(value) ? value : {};
  const normalizedImportId = normalizeNullableId(importId ?? source.importId) ?? '';
  const canceled = source.canceled === true;

  return {
    ok: canceled,
    importId: normalizedImportId,
    canceled,
    error: canceled
      ? null
      : normalizeBackendFailure(source.error, {
          category: BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
          operation: DATA_SOURCE_METHODS.cancelImport,
          message: 'Import cancellation is unavailable.',
          recoverable: false,
          importId: normalizedImportId,
        }),
  };
}

/** Normalize compact dataset metadata without retaining source rows. */
export function normalizeDatasetSummary(value) {
  const source = isRecord(value) ? value : {};
  const seenIds = new Set();
  const datasets = [];

  for (const item of Array.isArray(source.datasets) ? source.datasets : []) {
    const dataset = normalizeDatasetSummaryItem(item);
    if (!dataset || seenIds.has(dataset.id)) continue;
    seenIds.add(dataset.id);
    datasets.push(dataset);
  }

  const requestedSelection = normalizeNullableId(source.selectedDatasetId);
  return {
    datasets,
    selectedDatasetId: requestedSelection && seenIds.has(requestedSelection)
      ? requestedSelection
      : null,
    timeline: normalizeTimelineSummary(source.timeline),
  };
}

/** Normalize one dataset summary and explicitly omit complete row arrays. */
export function normalizeDatasetSummaryItem(value) {
  if (!isRecord(value)) return null;
  const id = normalizeNullableId(value.id);
  const name = normalizeDisplayName(value.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    enabled: value.enabled === true,
    headers: normalizeStringList(value.headers),
    rowCount: normalizeNonNegativeInteger(value.rowCount),
    totalRows: normalizeNonNegativeInteger(value.totalRows ?? value.rowCount),
    sizeBytes: normalizeOptionalNonNegativeInteger(value.sizeBytes ?? value.size),
    importedFeatureCount: normalizeOptionalNonNegativeInteger(value.importedFeatureCount),
    skippedRowCount: normalizeOptionalNonNegativeInteger(value.skippedRowCount),
    importedAt: normalizeNullableString(value.importedAt),
    latField: normalizeNullableString(value.latField),
    lonField: normalizeNullableString(value.lonField),
    detectedFields: normalizeDetectedFields(value.detectedFields),
    parseErrors: normalizeStringList(value.parseErrors, MAX_STRING_LIST_ITEMS),
  };
}

/** Normalize selection, visibility, or removal results. */
export function normalizeDatasetMutationResult(value, context = {}) {
  const source = isRecord(value) ? value : {};
  const dataset = normalizeDatasetSummaryItem(source.dataset);
  const datasetId = normalizeNullableId(
    context.datasetId ?? source.datasetId ?? dataset?.id,
  );
  const ok = source.ok === true || source.updated === true || source.removed === true;

  return {
    ok,
    datasetId,
    changed: ok && (
      source.changed === true || source.updated === true || source.removed === true
    ),
    dataset,
    error: ok
      ? null
      : normalizeBackendFailure(source.error, {
          category: BACKEND_FAILURE_CATEGORIES.DATASET_NOT_FOUND,
          operation: context.operation,
          message: context.message ?? 'The selected dataset is unavailable.',
          recoverable: true,
          datasetId,
        }),
  };
}

/** Normalize a coordinate mapping result and detected timeline fields. */
export function normalizeMappingMutationResult(value, datasetId) {
  const source = isRecord(value) ? value : {};
  const normalizedDatasetId = normalizeNullableId(datasetId ?? source.datasetId) ?? '';
  const ok = source.ok === true;

  return {
    ok,
    datasetId: normalizedDatasetId,
    mapping: ok ? normalizeCoordinateMapping(source.mapping) : null,
    detectedFields: ok ? normalizeDetectedFields(source.detectedFields) : null,
    dataset: ok ? normalizeDatasetSummaryItem(source.dataset) : null,
    error: ok
      ? null
      : normalizeBackendFailure(source.error, {
          category: BACKEND_FAILURE_CATEGORIES.INVALID_MAPPING,
          operation: DATA_SOURCE_METHODS.updateDatasetMapping,
          message: 'The coordinate mapping is invalid.',
          recoverable: true,
          datasetId: normalizedDatasetId,
        }),
  };
}

function normalizeCoordinateMapping(value) {
  if (!isRecord(value)) return null;
  return {
    latField: normalizeNullableString(value.latField),
    lonField: normalizeNullableString(value.lonField),
  };
}

function normalizeDetectedFields(value) {
  if (!isRecord(value)) return null;
  return {
    latField: normalizeNullableString(value.latField),
    lonField: normalizeNullableString(value.lonField),
    yearField: normalizeNullableString(value.yearField),
    dateField: normalizeNullableString(value.dateField),
    dayOfYearField: normalizeNullableString(value.dayOfYearField),
    yearFromField: normalizeNullableString(value.yearFromField),
    yearToField: normalizeNullableString(value.yearToField),
    dateFromField: normalizeNullableString(value.dateFromField),
    dateToField: normalizeNullableString(value.dateToField),
  };
}

function normalizeTimelineSummary(value) {
  if (!isRecord(value)) return null;
  const yearMin = normalizeOptionalInteger(value.yearMin);
  const yearMax = normalizeOptionalInteger(value.yearMax);
  if (yearMin == null || yearMax == null) return null;
  return { yearMin: Math.min(yearMin, yearMax), yearMax: Math.max(yearMin, yearMax) };
}

/** Normalize an original-order source preview page. */
export function normalizePreviewPageResult(value, query = {}) {
  const source = isRecord(value) ? value : {};
  const datasetId = normalizeNullableId(query.datasetId ?? source.datasetId) ?? '';
  const offset = normalizeNonNegativeInteger(source.offset ?? query.offset);
  const limit = normalizePositiveInteger(
    source.limit ?? query.limit,
    DEFAULT_PREVIEW_ROWS_LIMIT,
  );
  const rows = normalizeRows(source.rows).slice(0, limit);
  const totalRows = Math.max(
    offset + rows.length,
    normalizeNonNegativeInteger(source.totalRows, rows.length),
  );

  return {
    datasetId,
    rows,
    offset,
    limit,
    totalRows,
    hasMore: offset + rows.length < totalRows,
  };
}

/** Normalize compact map data and remove undeclared payload fields. */
export function normalizeMapViewResult(value) {
  const source = isRecord(value) ? value : {};
  const points = Array.isArray(source.points)
    ? source.points.map(normalizePointFeature).filter(Boolean)
    : [];
  const lines = Array.isArray(source.lines)
    ? source.lines.map(normalizeLineFeature).filter(Boolean)
    : [];
  const regions = Array.isArray(source.regions)
    ? source.regions.map(normalizeRegionFeature).filter(Boolean)
    : [];

  return {
    points,
    lines,
    regions,
    stats: normalizeMapViewStats(source.stats, points.length + lines.length + regions.length),
    timelineIndex: normalizeTimelineIndex(source.timelineIndex),
  };
}

/** Normalize an exact feature detail lookup. */
export function normalizeFeatureDetailsResult(value) {
  const source = isRecord(value) ? value : {};
  return {
    featureId: normalizeNullableId(source.featureId),
    row: normalizeRow(source.row),
    latField: normalizeNullableString(source.latField),
    lonField: normalizeNullableString(source.lonField),
  };
}

/** Normalize deterministic grouped rows separately from preview pages. */
export function normalizeGroupRowsResult(value, query = {}) {
  const source = isRecord(value) ? value : {};
  const offset = normalizeNonNegativeInteger(source.offset ?? query.offset);
  const limit = normalizePositiveInteger(
    source.limit ?? query.limit,
    DEFAULT_GROUP_ROWS_LIMIT,
  );
  const rows = normalizeRows(source.rows).slice(0, limit);
  const totalRows = Math.max(
    offset + rows.length,
    normalizeNonNegativeInteger(source.totalRows, rows.length),
  );

  return {
    rows,
    offset,
    limit,
    totalRows,
    hasMore: offset + rows.length < totalRows,
  };
}

function normalizePointFeature(value) {
  if (!isRecord(value)) return null;
  const id = normalizeNullableId(value.id);
  const lat = normalizeLatitude(value.lat);
  const lon = normalizeLongitude(value.lon);
  if (!id || lat == null || lon == null) return null;

  const renderType = POINT_RENDER_TYPES.has(value.renderType)
    ? value.renderType
    : 'exact';

  return {
    id,
    renderType,
    lat,
    lon,
    count: normalizePositiveInteger(value.count, 1),
    groupId: normalizeNullableId(value.groupId),
    groupRef: normalizeGroupRef(value.groupRef),
    sourceRef: normalizeFeatureSourceRef(value.sourceRef),
    marker: normalizeNullableString(value.marker),
    image: normalizeNullableString(value.image),
    imageWidthMeters: normalizeOptionalPositiveNumber(value.imageWidthMeters),
    imageHeightMeters: normalizeOptionalPositiveNumber(value.imageHeightMeters),
    latField: normalizeNullableString(value.latField),
    lonField: normalizeNullableString(value.lonField),
  };
}

function normalizeLineFeature(value) {
  if (!isRecord(value)) return null;
  const id = normalizeNullableId(value.id);
  const coordinates = normalizeCoordinates(value.coordinates, 2, false);
  if (!id || !coordinates) return null;

  return {
    id,
    featureId: normalizeNullableId(value.featureId),
    coordinates,
    style: normalizeStyle(value.style),
    arrow: LINE_ARROW_MODES.has(value.arrow) ? value.arrow : 'none',
    sourceRef: normalizeFeatureSourceRef(value.sourceRef),
    latField: normalizeNullableString(value.latField),
    lonField: normalizeNullableString(value.lonField),
  };
}

function normalizeRegionFeature(value) {
  if (!isRecord(value)) return null;
  const id = normalizeNullableId(value.id);
  const coordinates = normalizeCoordinates(value.coordinates, 3, true);
  if (!id || !coordinates) return null;

  return {
    id,
    featureId: normalizeNullableId(value.featureId),
    part: normalizeNullableString(value.part),
    coordinates,
    style: normalizeStyle(value.style),
    sourceRef: normalizeFeatureSourceRef(value.sourceRef),
    latField: normalizeNullableString(value.latField),
    lonField: normalizeNullableString(value.lonField),
  };
}

function normalizeMapViewStats(value, returnedCount) {
  const source = isRecord(value) ? value : {};
  const normalizedReturnedCount = normalizeNonNegativeInteger(
    source.returnedCount,
    returnedCount,
  );
  const totalMatchingCount = Math.max(
    normalizedReturnedCount,
    normalizeNonNegativeInteger(source.totalMatchingCount, normalizedReturnedCount),
  );
  const hiddenByRenderBudget = normalizeNonNegativeInteger(
    source.hiddenByRenderBudget,
    Math.max(0, totalMatchingCount - normalizedReturnedCount),
  );
  const skippedPointsByTimeline = normalizeNonNegativeInteger(source.skippedPointsByTimeline);
  const skippedLinesByTimeline = normalizeNonNegativeInteger(source.skippedLinesByTimeline);
  const skippedRegionsByTimeline = normalizeNonNegativeInteger(source.skippedRegionsByTimeline);
  const totalMatchingLineCount = normalizeNonNegativeInteger(
    source.totalMatchingLineCount,
  );
  const totalMatchingRegionCount = normalizeNonNegativeInteger(
    source.totalMatchingRegionCount,
  );
  const returnedLineCount = normalizeNonNegativeInteger(
    source.returnedLineCount,
  );
  const returnedRegionCount = normalizeNonNegativeInteger(
    source.returnedRegionCount,
  );
  const hiddenGeometryCount = normalizeNonNegativeInteger(
    source.hiddenGeometryCount,
  );

  return {
    skippedPoints: normalizeNonNegativeInteger(source.skippedPoints),
    skippedLines: normalizeNonNegativeInteger(source.skippedLines),
    skippedRegions: normalizeNonNegativeInteger(source.skippedRegions),
    skippedPointsByTimeline,
    skippedLinesByTimeline,
    skippedRegionsByTimeline,
    skippedByTimeline: normalizeNonNegativeInteger(
      source.skippedByTimeline,
      skippedPointsByTimeline + skippedLinesByTimeline + skippedRegionsByTimeline,
    ),
    limitedToRenderBudget: normalizeOptionalNonNegativeInteger(source.limitedToRenderBudget),
    totalMatchingCount,
    returnedCount: normalizedReturnedCount,
    hiddenByRenderBudget,
    overBudget: source.overBudget === true || hiddenByRenderBudget > 0,
    totalMatchingLineCount,
    totalMatchingRegionCount,
    returnedLineCount,
    returnedRegionCount,
    hiddenGeometryCount,
    geometryLimit: normalizeOptionalNonNegativeInteger(source.geometryLimit),
    geometryOverLimit:
      source.geometryOverLimit === true || hiddenGeometryCount > 0,
  };
}

function normalizeFeatureSourceRef(value) {
  if (!isRecord(value)) return null;
  const datasetId = normalizeNullableId(value.datasetId);
  const rowIndex = normalizeOptionalNonNegativeInteger(value.rowIndex);
  if (!datasetId || rowIndex == null) return null;
  return { datasetId, rowIndex };
}

function normalizeGroupRef(value) {
  if (!isRecord(value) || value.sortOrder !== 'dataset-source-row') return null;
  const groupId = normalizeNullableId(value.groupId);
  const bounds = normalizeBounds(value.bounds);
  const grid = normalizeGroupGrid(value.grid);
  const timeline = normalizeCapturedTimeline(value.timeline);
  const datasetIds = value.datasetIds == null
    ? null
    : normalizeGroupDatasetIds(value.datasetIds);
  if (!groupId || !bounds || !grid || timeline === undefined) return null;
  if (value.datasetIds != null && datasetIds.length === 0) return null;
  if (groupId !== ['grid', grid.cellLat, grid.cellLon].join(':')) return null;

  return {
    groupId,
    bounds,
    ...(datasetIds == null ? {} : { datasetIds }),
    timeline,
    grid,
    sortOrder: 'dataset-source-row',
  };
}

function normalizeGroupDatasetIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeNullableId).filter(Boolean))].sort();
}

function normalizeBounds(value) {
  if (!isRecord(value)) return null;
  const north = normalizeLatitude(value.north);
  const south = normalizeLatitude(value.south);
  const east = normalizeLongitude(value.east);
  const west = normalizeLongitude(value.west);
  if (north == null || south == null || east == null || west == null) return null;
  if (north < south) return null;
  return { north, south, east, west };
}

function normalizeGroupGrid(value) {
  if (!isRecord(value)) return null;
  const cellLat = normalizeOptionalInteger(value.cellLat);
  const cellLon = normalizeOptionalInteger(value.cellLon);
  const cellHeight = normalizeOptionalPositiveNumber(value.cellHeight);
  const cellWidth = normalizeOptionalPositiveNumber(value.cellWidth);
  if (cellLat == null || cellLon == null || cellHeight == null || cellWidth == null) {
    return null;
  }
  return { cellLat, cellLon, cellHeight, cellWidth };
}

function normalizeCapturedTimeline(value) {
  if (!value?.timelineEnabled) return null;
  const startYear = normalizeOptionalInteger(value.startYear);
  const endYear = normalizeOptionalInteger(value.endYear);
  if (startYear == null || endYear == null) return undefined;

  return {
    timelineEnabled: true,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
    dayFilterEnabled: value.dayFilterEnabled === true,
    startDay: normalizeDayOfYear(value.startDay),
    endDay: normalizeDayOfYear(value.endDay),
  };
}

function normalizeTimelineIndex(value) {
  const entries = [];
  for (const item of Array.isArray(value?.entries) ? value.entries : []) {
    if (!isRecord(item)) continue;
    const featureId = normalizeNullableId(item.featureId);
    const startYear = normalizeOptionalInteger(item.startYear);
    const endYear = normalizeOptionalInteger(item.endYear);
    if (!featureId || startYear == null || endYear == null) continue;
    entries.push({
      featureId,
      startYear: Math.min(startYear, endYear),
      endYear: Math.max(startYear, endYear),
    });
  }
  return { entries };
}

function normalizeCoordinates(value, minimumLength, closeRing) {
  if (!Array.isArray(value)) return null;
  const coordinates = value.map(normalizeCoordinate).filter(Boolean);
  if (coordinates.length < minimumLength) return null;

  if (closeRing && !coordinatesEqual(coordinates[0], coordinates.at(-1))) {
    coordinates.push([...coordinates[0]]);
  }
  return coordinates;
}

function normalizeCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = normalizeLatitude(value[0]);
  const lon = normalizeLongitude(value[1]);
  return lat == null || lon == null ? null : [lat, lon];
}

function coordinatesEqual(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

function normalizeStyle(value) {
  if (!isRecord(value)) return null;
  const style = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      STYLE_KEYS.has(key) &&
      (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
    ) {
      style[key] = item;
    }
  }
  return style;
}

function normalizeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeRow).filter(Boolean);
}

function normalizeRow(value) {
  if (!isRecord(value)) return null;
  const row = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isSafeRecordKey(key)) continue;
    if (item === null || item === undefined) {
      row[key] = '';
    } else if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      row[key] = String(item);
    }
  }
  return row;
}

function isSafeRecordKey(key) {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSafeMessage(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : 'The data backend operation failed.';
}

function normalizeNullableId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().split(/[\\/]/).pop() || null;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = normalizeFiniteNumber(value);
  return number == null ? fallback : Math.max(0, Math.trunc(number));
}

function normalizeOptionalNonNegativeInteger(value) {
  const number = normalizeFiniteNumber(value);
  if (number == null || number < 0) return null;
  return Math.trunc(number);
}

function normalizeOptionalInteger(value) {
  const number = normalizeFiniteNumber(value);
  return number == null ? null : Math.trunc(number);
}

function normalizeOptionalPositiveNumber(value) {
  const number = normalizeFiniteNumber(value);
  return number != null && number > 0 ? number : null;
}

function normalizeLatitude(value) {
  const number = normalizeFiniteNumber(value);
  return number != null && number >= -90 && number <= 90 ? number : null;
}

function normalizeLongitude(value) {
  const number = normalizeFiniteNumber(value);
  return number != null && number >= -180 && number <= 180 ? number : null;
}

function normalizeDayOfYear(value) {
  const day = normalizeOptionalInteger(value);
  return day != null && day >= 1 && day <= 365 ? day : null;
}

function normalizePositiveInteger(value, fallback) {
  const number = normalizeFiniteNumber(value);
  if (number == null) return fallback;
  const integer = Math.trunc(number);
  return integer > 0 ? integer : fallback;
}

function normalizeStringList(value, limit = null) {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((item) => typeof item === 'string');
  return limit == null ? strings : strings.slice(0, limit);
}
