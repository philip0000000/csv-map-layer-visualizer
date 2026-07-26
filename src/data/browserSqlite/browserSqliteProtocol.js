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
