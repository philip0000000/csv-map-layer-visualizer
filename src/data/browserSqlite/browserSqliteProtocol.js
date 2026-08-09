import { DEFAULT_PREVIEW_ROWS_LIMIT } from '../dataSource.js';

/** Maximum number of browser files accepted by one import protocol request. */
export const MAX_BROWSER_SQLITE_IMPORT_FILES = 100;

/** Fixed named operations accepted by the dedicated database worker. */
export const BROWSER_SQLITE_OPERATIONS = Object.freeze({
  INITIALIZE: 'initialize',
  IMPORT_FILES: 'import-files',
  CANCEL_IMPORT: 'cancel-import',
  GET_DATASET_SUMMARY: 'get-dataset-summary',
  SET_DATASET_ENABLED: 'set-dataset-enabled',
  REMOVE_DATASET: 'remove-dataset',
  UPDATE_DATASET_MAPPING: 'update-dataset-mapping',
  GET_PREVIEW_PAGE: 'get-preview-page',
  QUERY_MAP_VIEW: 'query-map-view',
  GET_FEATURE_DETAILS: 'get-feature-details',
  GET_GROUP_ROWS: 'get-group-rows',
  GET_LOGICAL_ZONE: 'get-logical-zone',
  UPDATE_LOGICAL_ZONE: 'update-logical-zone',
  CLOSE: 'close',
});

const OPERATION_SET = new Set(Object.values(BROWSER_SQLITE_OPERATIONS));
const PROGRESS_STATES = new Set([
  'queued',
  'started',
  'parsing',
  'storing',
  'completed',
]);
const MAX_PROTOCOL_ID_LENGTH = 256;
export const BROWSER_SQLITE_ERROR_MESSAGES = Object.freeze({
  'invalid-request': 'The worker request is invalid.',
  'unsupported-operation': 'The worker operation is unsupported.',
  'database-not-initialized': 'The temporary database is not initialized.',
  'dataset-not-found': 'The requested dataset is unavailable.',
  'invalid-mapping': 'The coordinate mapping is invalid.',
  'import-failed': 'The CSV import failed.',
  'import-canceled': 'Import canceled.',
  'worker-unavailable': 'The temporary database worker is unavailable.',
  'operation-failed': 'The temporary database operation failed.',
  'initialization-failed': 'The temporary database could not be initialized.',
});

/**
 * Validate and normalize one main-thread request before worker dispatch.
 *
 * Request and payload keys are strict. SQL, database bytes or handles, URLs,
 * paths, Electron values, and other unrestricted fields are rejected because
 * no named operation declares them.
 *
 * @param {unknown} message Candidate worker message.
 * @returns {{ requestId: string, operation: string, payload: object }} Request.
 */
export function validateBrowserSqliteRequest(message) {
  requirePlainRecord(message, 'invalid-request', 'A request object is required.');
  requireOnlyKeys(message, ['requestId', 'operation', 'payload']);
  const requestId = normalizeIdentifier(
    message.requestId,
    'request ID',
    'invalid-request',
  );
  const operation = normalizeOperation(message.operation);
  const payload = normalizeOperationPayload(operation, message.payload);

  return { requestId, operation, payload };
}

/** Build one correlated success response containing JSON-safe worker data. */
export function createBrowserSqliteSuccessResponse(requestId, result) {
  const normalizedRequestId = normalizeIdentifier(
    requestId,
    'request ID',
    'invalid-response',
  );
  requireJsonSafeResult(result);
  return {
    type: 'response',
    requestId: normalizedRequestId,
    ok: true,
    result,
  };
}

/** Build one correlated failure response from a stable safe error code. */
export function createBrowserSqliteFailureResponse(requestId, code) {
  const normalizedRequestId = normalizeIdentifier(
    requestId,
    'request ID',
    'invalid-response',
  );
  const normalizedCode = Object.hasOwn(BROWSER_SQLITE_ERROR_MESSAGES, code)
    ? code
    : 'operation-failed';

  return {
    type: 'response',
    requestId: normalizedRequestId,
    ok: false,
    error: {
      code: normalizedCode,
      message: BROWSER_SQLITE_ERROR_MESSAGES[normalizedCode],
    },
  };
}

/** Build a safe failure for a message that cannot be request-correlated. */
export function createBrowserSqliteUncorrelatedFailureResponse(code) {
  const normalizedCode = Object.hasOwn(BROWSER_SQLITE_ERROR_MESSAGES, code)
    ? code
    : 'invalid-request';
  return {
    type: 'response',
    requestId: null,
    ok: false,
    error: {
      code: normalizedCode,
      message: BROWSER_SQLITE_ERROR_MESSAGES[normalizedCode],
    },
  };
}

/**
 * Validate and build one source-row-free import progress event.
 *
 * @param {unknown} value Internal progress candidate.
 * @returns {object} Strict worker progress envelope.
 */
export function createBrowserSqliteProgressEvent(value) {
  requirePlainRecord(
    value,
    'invalid-progress',
    'A progress object is required.',
  );
  requireOnlyKeys(value, [
    'importId',
    'state',
    'fileName',
    'fileNumber',
    'totalFiles',
    'completedRows',
    'totalRows',
    'ok',
  ], 'invalid-progress');

  const importId = normalizeIdentifier(
    value.importId,
    'import ID',
    'invalid-progress',
  );
  if (!PROGRESS_STATES.has(value.state)) {
    throwProtocolError('invalid-progress', 'The progress state is invalid.');
  }
  const fileName = normalizeDisplayFileName(value.fileName, 'invalid-progress');
  const fileNumber = normalizePositiveInteger(
    value.fileNumber,
    'file number',
    'invalid-progress',
  );
  const totalFiles = normalizePositiveInteger(
    value.totalFiles,
    'total file count',
    'invalid-progress',
  );
  if (fileNumber > totalFiles) {
    throwProtocolError(
      'invalid-progress',
      'The progress file number exceeds the total file count.',
    );
  }

  const completedRows = normalizeNullableCount(
    value.completedRows,
    'completed row count',
    'invalid-progress',
  );
  const totalRows = normalizeNullableCount(
    value.totalRows,
    'total row count',
    'invalid-progress',
  );
  if (
    completedRows != null &&
    totalRows != null &&
    completedRows > totalRows
  ) {
    throwProtocolError(
      'invalid-progress',
      'Completed rows cannot exceed total rows.',
    );
  }
  if (value.state === 'completed' && typeof value.ok !== 'boolean') {
    throwProtocolError(
      'invalid-progress',
      'Completed progress requires a boolean result.',
    );
  }

  return {
    type: 'progress',
    importId,
    state: value.state,
    fileName,
    fileNumber,
    totalFiles,
    completedRows,
    totalRows,
    ok: value.state === 'completed' ? value.ok : null,
  };
}

function normalizeOperation(value) {
  if (typeof value === 'string' && OPERATION_SET.has(value)) return value;
  throwProtocolError(
    'unsupported-operation',
    'A supported named worker operation is required.',
  );
}

function normalizeOperationPayload(operation, payload) {
  switch (operation) {
    case BROWSER_SQLITE_OPERATIONS.INITIALIZE:
    case BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY:
    case BROWSER_SQLITE_OPERATIONS.CLOSE:
      return normalizeEmptyPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.IMPORT_FILES:
      return normalizeImportFilesPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.CANCEL_IMPORT:
      return normalizeCancelImportPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.SET_DATASET_ENABLED:
      return normalizeDatasetEnabledPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.REMOVE_DATASET:
      return normalizeDatasetIdPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.UPDATE_DATASET_MAPPING:
      return normalizeDatasetMappingPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.GET_PREVIEW_PAGE:
      return normalizePreviewPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.QUERY_MAP_VIEW:
      return normalizeMapViewPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.GET_FEATURE_DETAILS:
      return normalizeFeatureDetailsPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.GET_GROUP_ROWS:
      return normalizeGroupRowsPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.GET_LOGICAL_ZONE:
      return normalizeLogicalZoneIdentityPayload(payload);
    case BROWSER_SQLITE_OPERATIONS.UPDATE_LOGICAL_ZONE:
      return normalizeLogicalZoneUpdatePayload(payload);
    default:
      throwProtocolError(
        'unsupported-operation',
        'A supported named worker operation is required.',
      );
  }
}

function normalizeEmptyPayload(payload) {
  if (payload == null) return {};
  requirePlainRecord(payload, 'invalid-request', 'The payload must be an object.');
  requireOnlyKeys(payload, []);
  return {};
}

function normalizeImportFilesPayload(payload) {
  requirePayload(payload, ['importId', 'files']);
  const importId = normalizeIdentifier(
    payload.importId,
    'import ID',
    'invalid-request',
  );
  if (
    !Array.isArray(payload.files) ||
    payload.files.length === 0 ||
    payload.files.length > MAX_BROWSER_SQLITE_IMPORT_FILES
  ) {
    throwProtocolError(
      'invalid-file-list',
      `Import requests require 1 to ${MAX_BROWSER_SQLITE_IMPORT_FILES} browser files.`,
    );
  }

  return {
    importId,
    files: payload.files.map(validateBrowserFile),
  };
}

function normalizeCancelImportPayload(payload) {
  requirePayload(payload, ['importId']);
  return {
    importId: normalizeIdentifier(
      payload.importId,
      'import ID',
      'invalid-request',
    ),
  };
}

function normalizeDatasetEnabledPayload(payload) {
  requirePayload(payload, ['datasetId', 'enabled']);
  if (typeof payload.enabled !== 'boolean') {
    throwProtocolError(
      'invalid-request',
      'Dataset visibility must be a boolean.',
    );
  }
  return {
    datasetId: normalizeIdentifier(
      payload.datasetId,
      'dataset ID',
      'invalid-request',
    ),
    enabled: payload.enabled,
  };
}

function normalizeDatasetIdPayload(payload) {
  requirePayload(payload, ['datasetId']);
  return {
    datasetId: normalizeIdentifier(
      payload.datasetId,
      'dataset ID',
      'invalid-request',
    ),
  };
}

function normalizeDatasetMappingPayload(payload) {
  requirePayload(payload, ['datasetId', 'mapping']);
  requirePlainRecord(
    payload.mapping,
    'invalid-request',
    'Coordinate mapping must be an object.',
  );
  requireOnlyKeys(payload.mapping, ['latField', 'lonField']);
  const mapping = {};
  if (Object.hasOwn(payload.mapping, 'latField')) {
    mapping.latField = normalizeMappingField(payload.mapping.latField);
  }
  if (Object.hasOwn(payload.mapping, 'lonField')) {
    mapping.lonField = normalizeMappingField(payload.mapping.lonField);
  }

  return {
    datasetId: normalizeIdentifier(
      payload.datasetId,
      'dataset ID',
      'invalid-request',
    ),
    mapping,
  };
}

function normalizePreviewPayload(payload) {
  requirePayload(payload, ['datasetId', 'offset', 'limit']);
  return {
    datasetId: normalizeIdentifier(
      payload.datasetId,
      'dataset ID',
      'invalid-request',
    ),
    offset: normalizeOptionalInteger(payload.offset, 0, 0, 'preview offset'),
    limit: normalizeOptionalInteger(
      payload.limit,
      DEFAULT_PREVIEW_ROWS_LIMIT,
      1,
      'preview limit',
    ),
  };
}

function normalizeMapViewPayload(payload) {
  requirePayload(payload, [
    'bounds',
    'zoom',
    'timeline',
    'renderBudget',
    'datasetIds',
  ]);
  return {
    bounds: normalizeBoundsPayload(payload.bounds),
    zoom: normalizeNullableFiniteNumber(payload.zoom, 'map zoom'),
    timeline: normalizeTimelinePayload(payload.timeline),
    renderBudget: normalizeOptionalInteger(
      payload.renderBudget,
      null,
      1,
      'render budget',
    ),
    datasetIds: normalizeDatasetIdsPayload(payload.datasetIds),
  };
}

function normalizeFeatureDetailsPayload(payload) {
  requirePayload(payload, ['featureId', 'sourceRef']);
  return {
    featureId: payload.featureId == null
      ? null
      : normalizeIdentifier(payload.featureId, 'feature ID', 'invalid-request'),
    sourceRef: normalizeSourceRefPayload(payload.sourceRef),
  };
}

function normalizeGroupRowsPayload(payload) {
  requirePayload(payload, ['groupRef', 'offset', 'limit']);
  return {
    groupRef: normalizeGroupRefPayload(payload.groupRef),
    offset: normalizeOptionalInteger(payload.offset, 0, 0, 'group offset'),
    limit: Math.min(
      normalizeOptionalInteger(payload.limit, 30, 1, 'group limit'),
      100,
    ),
  };
}

function normalizeLogicalZoneIdentityPayload(payload) {
  requirePayload(payload, ['datasetId', 'featureId']);
  return {
    datasetId: normalizeIdentifier(payload.datasetId, 'dataset ID', 'invalid-request'),
    featureId: normalizeIdentifier(payload.featureId, 'feature ID', 'invalid-request'),
  };
}

/** Bound complete-zone coordinates before they enter the worker transaction queue. */
function normalizeLogicalZoneUpdatePayload(payload) {
  requirePayload(payload, ['datasetId', 'featureId', 'parts']);
  const identity = normalizeLogicalZoneIdentityPayload({
    datasetId: payload.datasetId,
    featureId: payload.featureId,
  });
  if (!Array.isArray(payload.parts) || payload.parts.length === 0 || payload.parts.length > 1000) {
    throwProtocolError('invalid-request', 'A bounded logical-zone part list is required.');
  }
  let coordinateCount = 0;
  const parts = payload.parts.map((part) => {
    requirePlainRecord(part, 'invalid-request', 'A logical-zone part must be an object.');
    requireOnlyKeys(part, ['part', 'coordinates']);
    if (!Array.isArray(part.coordinates) || part.coordinates.length < 4) {
      throwProtocolError('invalid-request', 'A region part requires a coordinate ring.');
    }
    coordinateCount += part.coordinates.length;
    const coordinates = part.coordinates.map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length !== 2) {
        throwProtocolError('invalid-request', 'A zone coordinate must be a latitude-longitude pair.');
      }
      return [
        normalizeFiniteNumber(coordinate[0], 'zone latitude'),
        normalizeFiniteNumber(coordinate[1], 'zone longitude'),
      ];
    });
    return {
      part: normalizeIdentifier(part.part, 'part ID', 'invalid-request'),
      coordinates,
    };
  });
  if (coordinateCount > 100000) {
    throwProtocolError('invalid-request', 'The logical zone contains too many coordinates.');
  }
  return { ...identity, parts };
}

function normalizeBoundsPayload(value) {
  if (value == null) return null;
  requirePlainRecord(value, 'invalid-request', 'Map bounds must be an object.');
  requireOnlyKeys(value, ['north', 'south', 'east', 'west']);
  return {
    north: normalizeFiniteNumber(value.north, 'north bound'),
    south: normalizeFiniteNumber(value.south, 'south bound'),
    east: normalizeFiniteNumber(value.east, 'east bound'),
    west: normalizeFiniteNumber(value.west, 'west bound'),
  };
}

function normalizeTimelinePayload(value) {
  if (value == null) return null;
  requirePlainRecord(value, 'invalid-request', 'Timeline state must be an object.');
  requireOnlyKeys(value, [
    'timelineEnabled',
    'startYear',
    'endYear',
    'yearMin',
    'yearMax',
    'dayFilterEnabled',
    'startDay',
    'endDay',
  ]);
  if (
    Object.hasOwn(value, 'timelineEnabled') &&
    typeof value.timelineEnabled !== 'boolean'
  ) {
    throwProtocolError('invalid-request', 'Timeline enabled state is invalid.');
  }
  if (
    Object.hasOwn(value, 'dayFilterEnabled') &&
    typeof value.dayFilterEnabled !== 'boolean'
  ) {
    throwProtocolError('invalid-request', 'Timeline day-filter state is invalid.');
  }
  return {
    timelineEnabled: value.timelineEnabled === true,
    startYear: normalizeNullableInteger(value.startYear, 'timeline start year'),
    endYear: normalizeNullableInteger(value.endYear, 'timeline end year'),
    yearMin: normalizeNullableInteger(value.yearMin, 'timeline minimum year'),
    yearMax: normalizeNullableInteger(value.yearMax, 'timeline maximum year'),
    dayFilterEnabled: value.dayFilterEnabled === true,
    startDay: normalizeNullableInteger(value.startDay, 'timeline start day'),
    endDay: normalizeNullableInteger(value.endDay, 'timeline end day'),
  };
}

function normalizeDatasetIdsPayload(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 100) {
    throwProtocolError('invalid-request', 'Dataset IDs must be a bounded array.');
  }
  return [...new Set(value.map((id) => (
    normalizeIdentifier(id, 'dataset ID', 'invalid-request')
  )))].sort();
}

function normalizeSourceRefPayload(value) {
  if (value == null) return null;
  requirePlainRecord(value, 'invalid-request', 'A source reference must be an object.');
  requireOnlyKeys(value, ['datasetId', 'rowIndex']);
  return {
    datasetId: normalizeIdentifier(
      value.datasetId,
      'dataset ID',
      'invalid-request',
    ),
    rowIndex: normalizeOptionalInteger(
      value.rowIndex,
      null,
      0,
      'source-row index',
    ),
  };
}

function normalizeGroupRefPayload(value) {
  if (value == null) return null;
  requirePlainRecord(value, 'invalid-request', 'A group reference must be an object.');
  requireOnlyKeys(value, [
    'groupId',
    'bounds',
    'datasetIds',
    'timeline',
    'grid',
    'sortOrder',
  ]);
  if (value.sortOrder !== 'dataset-source-row') {
    throwProtocolError('invalid-request', 'The group sort order is invalid.');
  }
  const datasetIds = normalizeDatasetIdsPayload(value.datasetIds);
  if (!datasetIds || datasetIds.length === 0) {
    throwProtocolError('invalid-request', 'A group dataset snapshot is required.');
  }
  const grid = normalizeGroupGridPayload(value.grid);
  const groupId = normalizeIdentifier(value.groupId, 'group ID', 'invalid-request');
  if (groupId !== `grid:${grid.cellLat}:${grid.cellLon}`) {
    throwProtocolError('invalid-request', 'The group ID is invalid.');
  }
  return {
    groupId,
    bounds: normalizeBoundsPayload(value.bounds),
    datasetIds,
    timeline: normalizeTimelinePayload(value.timeline),
    grid,
    sortOrder: 'dataset-source-row',
  };
}

function normalizeGroupGridPayload(value) {
  requirePlainRecord(value, 'invalid-request', 'A group grid must be an object.');
  requireOnlyKeys(value, ['cellLat', 'cellLon', 'cellHeight', 'cellWidth']);
  return {
    cellLat: normalizeRequiredInteger(value.cellLat, 'grid latitude cell'),
    cellLon: normalizeRequiredInteger(value.cellLon, 'grid longitude cell'),
    cellHeight: normalizePositiveFiniteNumber(value.cellHeight, 'grid cell height'),
    cellWidth: normalizePositiveFiniteNumber(value.cellWidth, 'grid cell width'),
  };
}

function requirePayload(payload, allowedKeys) {
  requirePlainRecord(payload, 'invalid-request', 'The payload must be an object.');
  requireOnlyKeys(payload, allowedKeys);
}

function validateBrowserFile(file) {
  if (
    !file ||
    typeof file !== 'object' ||
    typeof file.slice !== 'function' ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    typeof file.type !== 'string' ||
    !Number.isSafeInteger(file.lastModified) ||
    file.lastModified < 0
  ) {
    throwProtocolError(
      'invalid-file-list',
      'Every import item must be a browser File.',
    );
  }
  normalizeDisplayFileName(file.name, 'invalid-file-list');
  return file;
}

function normalizeDisplayFileName(value, code) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\\/]/.test(value)
  ) {
    throwProtocolError(code, 'A safe display file name is required.');
  }
  return value.trim();
}

function normalizeMappingField(value) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throwProtocolError(
      'invalid-request',
      'Mapping fields must be column names or null.',
    );
  }
  return value.trim() || null;
}

function normalizeIdentifier(value, label, code) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > MAX_PROTOCOL_ID_LENGTH
  ) {
    throwProtocolError(code, `A valid ${label} is required.`);
  }
  return value.trim();
}

function normalizeOptionalInteger(value, fallback, minimum, label) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throwProtocolError(
      'invalid-request',
      `${label} must be an integer of at least ${minimum}.`,
    );
  }
  return value;
}

function normalizeNullableInteger(value, label) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value)) {
    throwProtocolError('invalid-request', `${label} must be an integer or null.`);
  }
  return value;
}

function normalizeRequiredInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throwProtocolError('invalid-request', `${label} must be an integer.`);
  }
  return value;
}

function normalizeFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwProtocolError('invalid-request', `${label} must be a finite number.`);
  }
  return value;
}

function normalizeNullableFiniteNumber(value, label) {
  return value == null ? null : normalizeFiniteNumber(value, label);
}

function normalizePositiveFiniteNumber(value, label) {
  const number = normalizeFiniteNumber(value, label);
  if (number <= 0) {
    throwProtocolError('invalid-request', `${label} must be positive.`);
  }
  return number;
}

function normalizePositiveInteger(value, label, code) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throwProtocolError(code, `${label} must be a positive integer.`);
  }
  return value;
}

function normalizeNullableCount(value, label, code) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throwProtocolError(code, `${label} must be a non-negative integer or null.`);
  }
  return value;
}

function requireOnlyKeys(value, allowedKeys, code = 'invalid-request') {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throwProtocolError(
        code,
        'The message contains an unsupported field.',
      );
    }
  }
}

function requirePlainRecord(value, code, message) {
  if (!isPlainRecord(value)) throwProtocolError(code, message);
}

function requireJsonSafeResult(value) {
  const seen = new WeakSet();
  validateJsonValue(value, seen, 0);
}

function validateJsonValue(value, seen, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (depth > 20 || (!Array.isArray(value) && !isPlainRecord(value))) {
    throwProtocolError(
      'invalid-response',
      'Worker responses must contain plain JSON-safe data.',
    );
  }
  if (seen.has(value)) {
    throwProtocolError(
      'invalid-response',
      'Worker responses cannot contain circular data.',
    );
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, seen, depth + 1);
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (
        typeof key !== 'string' ||
        key === '__proto__' ||
        key === 'prototype' ||
        key === 'constructor'
      ) {
        throwProtocolError(
          'invalid-response',
          'Worker responses contain an unsafe field.',
        );
      }
      validateJsonValue(value[key], seen, depth + 1);
    }
  }
  seen.delete(value);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function throwProtocolError(code, message) {
  throw new BrowserSqliteProtocolError(code, message);
}

export class BrowserSqliteProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteProtocolError';
    this.code = code;
  }
}
