import {
  BROWSER_SQLITE_ERROR_MESSAGES,
  BROWSER_SQLITE_OPERATIONS,
  BrowserSqliteProtocolError,
  createBrowserSqliteProgressEvent,
  createBrowserSqliteSuccessResponse,
  validateBrowserSqliteRequest,
} from './browserSqliteProtocol.js';

let clientInstanceSequence = 0;

/**
 * Create the main-thread client for one dedicated temporary SQLite worker.
 *
 * Requests are correlated by generated IDs. Import progress is delivered only
 * to listeners for the matching import ID. The client never exposes the worker,
 * database handles, SQL, or database bytes to consumers.
 *
 * @param {object} [options] Client dependencies, primarily for testing.
 * @param {Worker} [options.worker] Existing worker instance.
 * @param {() => Worker} [options.createWorker] Worker factory.
 * @param {() => string} [options.createRequestId] Request ID factory.
 * @param {() => string} [options.createImportId] Import ID factory.
 * @returns {object} Isolated browser SQLite worker client.
 */
export function createBrowserSqliteWorkerClient(options = {}) {
  if (!isPlainRecord(options)) {
    throw new TypeError('Browser SQLite worker client options must be an object.');
  }

  const worker = options.worker ?? (options.createWorker ?? createDefaultWorker)();
  requireWorker(worker);
  const createRequestId = normalizeIdFactory(
    options.createRequestId,
    createDefaultIdFactory('request'),
    'request',
  );
  const createImportId = normalizeIdFactory(
    options.createImportId,
    createDefaultIdFactory('import'),
    'import',
  );
  const pendingRequests = new Map();
  const issuedRequestIds = new Set();
  const activeImportIds = new Set();
  const progressListeners = new Map();
  let terminal = false;

  const handleMessage = (event) => {
    let message;
    try {
      message = event?.data;
    } catch {
      return;
    }

    if (message?.type === 'progress') {
      dispatchProgress(message);
      return;
    }
    if (message?.type !== 'response' || typeof message.requestId !== 'string') {
      return;
    }

    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    pendingRequests.delete(message.requestId);

    try {
      pending.resolve(readResponseResult(message));
    } catch (error) {
      pending.reject(normalizeClientError(error));
    }
  };
  const handleWorkerFailure = (event) => {
    try {
      event?.preventDefault?.();
    } catch {
      // Worker failure cleanup must continue even for a hostile event object.
    }
    transitionToTerminal();
  };

  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleWorkerFailure);
  worker.addEventListener('messageerror', handleWorkerFailure);

  function sendRequest(operation, payload = undefined) {
    if (terminal) return Promise.reject(createUnavailableError());

    let request;
    try {
      const requestId = createUniqueRequestId(createRequestId, issuedRequestIds);
      request = validateBrowserSqliteRequest(
        payload === undefined
          ? { requestId, operation }
          : { requestId, operation, payload },
      );
    } catch (error) {
      return Promise.reject(normalizeClientError(error, 'invalid-request'));
    }

    return new Promise((resolve, reject) => {
      pendingRequests.set(request.requestId, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch {
        pendingRequests.delete(request.requestId);
        reject(new BrowserSqliteWorkerClientError(
          'operation-failed',
          BROWSER_SQLITE_ERROR_MESSAGES['operation-failed'],
        ));
      }
    });
  }

  function dispatchProgress(message) {
    if (!hasOnlyKeys(message, [
      'type',
      'importId',
      'state',
      'fileName',
      'fileNumber',
      'totalFiles',
      'completedRows',
      'totalRows',
      'ok',
    ])) return;

    let progress;
    try {
      progress = createBrowserSqliteProgressEvent({
        importId: message.importId,
        state: message.state,
        fileName: message.fileName,
        fileNumber: message.fileNumber,
        totalFiles: message.totalFiles,
        completedRows: message.completedRows,
        totalRows: message.totalRows,
        ok: message.ok,
      });
    } catch {
      return;
    }

    const listeners = progressListeners.get(progress.importId);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(progress);
      } catch {
        // Progress listeners cannot interrupt request correlation or imports.
      }
    }
  }

  function subscribeImportProgress(importId, listener) {
    const normalizedImportId = normalizeClientId(importId, 'import ID');
    if (typeof listener !== 'function') {
      throw new TypeError('An import progress listener is required.');
    }
    if (terminal) return () => false;

    let listeners = progressListeners.get(normalizedImportId);
    if (!listeners) {
      listeners = new Set();
      progressListeners.set(normalizedImportId, listeners);
    }
    listeners.add(listener);
    let subscribed = true;

    return () => {
      if (!subscribed) return false;
      subscribed = false;
      listeners.delete(listener);
      if (listeners.size === 0) progressListeners.delete(normalizedImportId);
      return true;
    };
  }

  function startImport(files, importOptions = {}) {
    if (!isPlainRecord(importOptions)) {
      throw new TypeError('Import options must be an object.');
    }
    const importId = importOptions.importId == null
      ? normalizeClientId(createImportId(), 'import ID')
      : normalizeClientId(importOptions.importId, 'import ID');
    const onProgress = importOptions.onProgress;
    if (onProgress != null && typeof onProgress !== 'function') {
      throw new TypeError('Import progress must be a function.');
    }
    if (activeImportIds.has(importId)) {
      throw new BrowserSqliteWorkerClientError(
        'invalid-request',
        'The import ID is already active.',
      );
    }
    activeImportIds.add(importId);
    const unsubscribe = onProgress
      ? subscribeImportProgress(importId, onProgress)
      : null;
    const result = sendRequest(BROWSER_SQLITE_OPERATIONS.IMPORT_FILES, {
      importId,
      files,
    }).finally(() => {
      activeImportIds.delete(importId);
      unsubscribe?.();
    });

    return Object.freeze({
      importId,
      result,
      cancel: () => cancelImport(importId),
    });
  }

  function importFiles(files, importOptions = {}) {
    return startImport(files, importOptions).result;
  }

  function cancelImport(importId) {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.CANCEL_IMPORT, { importId });
  }

  function initialize() {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.INITIALIZE);
  }

  function getDatasetSummary() {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY);
  }

  function setDatasetEnabled(datasetId, enabled) {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.SET_DATASET_ENABLED, {
      datasetId,
      enabled,
    });
  }

  function removeDataset(datasetId) {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.REMOVE_DATASET, { datasetId });
  }

  function updateDatasetMapping(datasetId, mapping) {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.UPDATE_DATASET_MAPPING, {
      datasetId,
      mapping,
    });
  }

  function getPreviewPage(datasetId, page = {}) {
    if (!isPlainRecord(page)) {
      return Promise.reject(new BrowserSqliteWorkerClientError(
        'invalid-request',
        BROWSER_SQLITE_ERROR_MESSAGES['invalid-request'],
      ));
    }
    return sendRequest(BROWSER_SQLITE_OPERATIONS.GET_PREVIEW_PAGE, {
      ...page,
      datasetId,
    });
  }

  function queryMapView(query = {}) {
    if (!isPlainRecord(query)) return invalidRequestPromise();
    return sendRequest(BROWSER_SQLITE_OPERATIONS.QUERY_MAP_VIEW, query);
  }

  function getFeatureDetails(query = {}) {
    if (!isPlainRecord(query)) return invalidRequestPromise();
    return sendRequest(BROWSER_SQLITE_OPERATIONS.GET_FEATURE_DETAILS, query);
  }

  function getGroupRows(query = {}) {
    if (!isPlainRecord(query)) return invalidRequestPromise();
    return sendRequest(BROWSER_SQLITE_OPERATIONS.GET_GROUP_ROWS, query);
  }

  function close() {
    return sendRequest(BROWSER_SQLITE_OPERATIONS.CLOSE);
  }

  function dispose() {
    if (terminal) return false;
    transitionToTerminal();
    return true;
  }

  function transitionToTerminal() {
    if (terminal) return;
    terminal = true;
    worker.removeEventListener('message', handleMessage);
    worker.removeEventListener('error', handleWorkerFailure);
    worker.removeEventListener('messageerror', handleWorkerFailure);
    try {
      worker.terminate();
    } catch {
      // Pending callers still receive one stable worker-unavailable failure.
    }
    const error = createUnavailableError();
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
    activeImportIds.clear();
    progressListeners.clear();
  }

  return Object.freeze({
    initialize,
    importFiles,
    startImport,
    cancelImport,
    subscribeImportProgress,
    getDatasetSummary,
    setDatasetEnabled,
    removeDataset,
    updateDatasetMapping,
    getPreviewPage,
    queryMapView,
    getFeatureDetails,
    getGroupRows,
    close,
    dispose,
  });
}

function invalidRequestPromise() {
  return Promise.reject(new BrowserSqliteWorkerClientError(
    'invalid-request',
    BROWSER_SQLITE_ERROR_MESSAGES['invalid-request'],
  ));
}

function createDefaultWorker() {
  return new Worker(
    new URL('./browserSqliteWorker.js', import.meta.url),
    { type: 'module', name: 'browser-sqlite' },
  );
}

function readResponseResult(message) {
  if (!hasOnlyKeys(message, ['type', 'requestId', 'ok', 'result', 'error'])) {
    throw createOperationError();
  }
  if (message.ok === true && Object.hasOwn(message, 'result')) {
    if (Object.hasOwn(message, 'error')) throw createOperationError();
    return createBrowserSqliteSuccessResponse(
      message.requestId,
      message.result,
    ).result;
  }
  if (message.ok !== false || Object.hasOwn(message, 'result')) {
    throw createOperationError();
  }
  const error = message.error;
  if (
    !isPlainRecord(error) ||
    !hasOnlyKeys(error, ['code', 'message']) ||
    typeof error.code !== 'string' ||
    !Object.hasOwn(BROWSER_SQLITE_ERROR_MESSAGES, error.code) ||
    error.message !== BROWSER_SQLITE_ERROR_MESSAGES[error.code]
  ) {
    throw createOperationError();
  }
  throw new BrowserSqliteWorkerClientError(error.code, error.message);
}

function createUniqueRequestId(factory, issuedRequestIds) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const requestId = normalizeClientId(factory(), 'request ID');
    if (!issuedRequestIds.has(requestId)) {
      issuedRequestIds.add(requestId);
      return requestId;
    }
  }
  throw createOperationError();
}

function createDefaultIdFactory(kind) {
  clientInstanceSequence += 1;
  const instanceId = clientInstanceSequence.toString(36);
  let sequence = 0;
  return () => {
    sequence += 1;
    return `browser-sqlite-${kind}-${instanceId}-${sequence.toString(36)}`;
  };
}

function normalizeIdFactory(value, fallback, label) {
  if (value == null) return fallback;
  if (typeof value === 'function') return value;
  throw new TypeError(`The ${label} ID factory must be a function.`);
}

function normalizeClientId(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 256
  ) {
    throw new BrowserSqliteWorkerClientError(
      'invalid-request',
      `A valid ${label} is required.`,
    );
  }
  return value.trim();
}

function normalizeClientError(error, fallbackCode = 'operation-failed') {
  if (error instanceof BrowserSqliteWorkerClientError) return error;
  const code = error instanceof BrowserSqliteProtocolError &&
    Object.hasOwn(BROWSER_SQLITE_ERROR_MESSAGES, error.code)
    ? error.code
    : fallbackCode;
  return new BrowserSqliteWorkerClientError(
    code,
    BROWSER_SQLITE_ERROR_MESSAGES[code] ??
      BROWSER_SQLITE_ERROR_MESSAGES['operation-failed'],
  );
}

function createOperationError() {
  return new BrowserSqliteWorkerClientError(
    'operation-failed',
    BROWSER_SQLITE_ERROR_MESSAGES['operation-failed'],
  );
}

function createUnavailableError() {
  return new BrowserSqliteWorkerClientError(
    'worker-unavailable',
    BROWSER_SQLITE_ERROR_MESSAGES['worker-unavailable'],
  );
}

function requireWorker(worker) {
  if (
    !worker ||
    typeof worker.postMessage !== 'function' ||
    typeof worker.addEventListener !== 'function' ||
    typeof worker.removeEventListener !== 'function' ||
    typeof worker.terminate !== 'function'
  ) {
    throw new TypeError('A dedicated Worker-compatible object is required.');
  }
}

function hasOnlyKeys(value, allowedKeys) {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class BrowserSqliteWorkerClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteWorkerClientError';
    this.code = code;
  }
}
