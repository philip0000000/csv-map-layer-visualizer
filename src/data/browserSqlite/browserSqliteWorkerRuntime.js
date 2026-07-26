import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
  getBrowserSqliteSchemaVersion,
} from './browserSqliteDatabase.js';
import {
  setBrowserSqliteDatasetEnabled,
  updateBrowserSqliteDatasetMapping,
} from './browserSqliteDatasetMutations.js';
import {
  getBrowserSqliteDatasetSummary,
  getBrowserSqlitePreviewPage,
} from './browserSqliteDatasetQueries.js';
import {
  removeBrowserSqliteDataset,
} from './browserSqliteDatasetRemoval.js';
import {
  importBrowserSqliteCsvBatch,
} from './browserSqliteImportBatch.js';
import {
  getBrowserSqliteGroupRows,
  getBrowserSqliteFeatureDetails,
} from './browserSqlitePointDetails.js';
import {
  queryBrowserSqliteMapView,
} from './browserSqlitePointQueries.js';
import {
  BROWSER_SQLITE_OPERATIONS,
  BrowserSqliteProtocolError,
  createBrowserSqliteFailureResponse,
  createBrowserSqliteProgressEvent,
  createBrowserSqliteSuccessResponse,
  createBrowserSqliteUncorrelatedFailureResponse,
  validateBrowserSqliteRequest,
} from './browserSqliteProtocol.js';

const SAFE_RUNTIME_ERROR_CODES = new Set([
  'database-not-initialized',
  'dataset-not-found',
  'invalid-mapping',
  'import-canceled',
  'import-failed',
  'initialization-failed',
  'operation-failed',
  'worker-unavailable',
]);

/**
 * Create the stateful runtime owned by one dedicated browser SQLite worker.
 *
 * All database operations join one promise queue so unrelated statements can
 * never enter an active file transaction. Valid cancellation requests bypass
 * that queue and only set the matching active import flag.
 *
 * @param {object} dependencies Worker-owned runtime dependencies.
 * @param {() => Promise<object>} dependencies.initializeSql Initializes sql.js.
 * @param {(message: object) => void} dependencies.postMessage Posts to main thread.
 * @returns {{ handleMessage: (message: unknown) => Promise<object> }} Runtime.
 */
export function createBrowserSqliteWorkerRuntime({
  initializeSql,
  postMessage,
}) {
  if (typeof initializeSql !== 'function' || typeof postMessage !== 'function') {
    throw new TypeError(
      'Worker runtime requires SQL initialization and message posting functions.',
    );
  }

  let sqlModulePromise = null;
  let database = null;
  let activeImport = null;
  let operationQueue = Promise.resolve();

  async function handleMessage(message) {
    let request;
    try {
      request = validateBrowserSqliteRequest(message);
    } catch (error) {
      const code = error instanceof BrowserSqliteProtocolError &&
        error.code === 'unsupported-operation'
        ? 'unsupported-operation'
        : 'invalid-request';
      const requestId = extractUsableRequestId(message);
      const response = requestId
        ? createBrowserSqliteFailureResponse(requestId, code)
        : createBrowserSqliteUncorrelatedFailureResponse(code);
      postMessage(response);
      return response;
    }

    if (request.operation === BROWSER_SQLITE_OPERATIONS.CANCEL_IMPORT) {
      return handleCancellation(request);
    }

    const queuedOperation = operationQueue.then(() => dispatchAndRespond(request));
    operationQueue = queuedOperation.then(
      () => undefined,
      () => undefined,
    );
    return queuedOperation;
  }

  function handleCancellation(request) {
    const matches = activeImport?.importId === request.payload.importId;
    if (matches) activeImport.canceled = true;
    const response = createBrowserSqliteSuccessResponse(request.requestId, {
      importId: request.payload.importId,
      canceled: matches,
    });
    postMessage(response);
    return Promise.resolve(response);
  }

  async function dispatchAndRespond(request) {
    let response;
    try {
      const result = await dispatchOperation(request);
      response = createBrowserSqliteSuccessResponse(request.requestId, result);
    } catch (error) {
      response = createBrowserSqliteFailureResponse(
        request.requestId,
        selectSafeErrorCode(error, request.operation),
      );
    }
    postMessage(response);
    return response;
  }

  async function dispatchOperation(request) {
    switch (request.operation) {
      case BROWSER_SQLITE_OPERATIONS.INITIALIZE:
        return initializeDatabase();
      case BROWSER_SQLITE_OPERATIONS.IMPORT_FILES:
        return importFiles(request.payload);
      case BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY:
        return getBrowserSqliteDatasetSummary(requireDatabase(database));
      case BROWSER_SQLITE_OPERATIONS.SET_DATASET_ENABLED:
        return setBrowserSqliteDatasetEnabled(
          requireDatabase(database),
          request.payload.datasetId,
          request.payload.enabled,
        );
      case BROWSER_SQLITE_OPERATIONS.REMOVE_DATASET:
        return removeBrowserSqliteDataset(
          requireDatabase(database),
          request.payload.datasetId,
        );
      case BROWSER_SQLITE_OPERATIONS.UPDATE_DATASET_MAPPING:
        return updateBrowserSqliteDatasetMapping(
          requireDatabase(database),
          request.payload.datasetId,
          request.payload.mapping,
        );
      case BROWSER_SQLITE_OPERATIONS.GET_PREVIEW_PAGE:
        return getBrowserSqlitePreviewPage(
          requireDatabase(database),
          request.payload,
        );
      case BROWSER_SQLITE_OPERATIONS.QUERY_MAP_VIEW:
        return queryBrowserSqliteMapView(
          requireDatabase(database),
          request.payload,
        );
      case BROWSER_SQLITE_OPERATIONS.GET_FEATURE_DETAILS:
        return getBrowserSqliteFeatureDetails(
          requireDatabase(database),
          request.payload,
        );
      case BROWSER_SQLITE_OPERATIONS.GET_GROUP_ROWS:
        return getBrowserSqliteGroupRows(
          requireDatabase(database),
          request.payload,
        );
      case BROWSER_SQLITE_OPERATIONS.CLOSE:
        return closeDatabase();
      default:
        throw new BrowserSqliteWorkerRuntimeError(
          'operation-failed',
          'The temporary database operation failed.',
        );
    }
  }

  async function initializeDatabase() {
    if (database) {
      return createInitializationResult(database, true);
    }

    try {
      if (!sqlModulePromise) {
        sqlModulePromise = Promise.resolve().then(initializeSql);
      }
      const SQL = await sqlModulePromise;
      database = createBrowserSqliteDatabase(SQL);
      return createInitializationResult(database, false);
    } catch {
      sqlModulePromise = null;
      database = null;
      throw new BrowserSqliteWorkerRuntimeError(
        'initialization-failed',
        'The temporary database could not be initialized.',
      );
    }
  }

  async function importFiles(payload) {
    const targetDatabase = requireDatabase(database);
    const importRecord = {
      importId: payload.importId,
      canceled: false,
    };
    activeImport = importRecord;

    try {
      return await importBrowserSqliteCsvBatch(
        targetDatabase,
        payload.files,
        {
          importId: payload.importId,
          shouldCancel: () => importRecord.canceled,
          onProgress: (progress) => {
            postMessage(createBrowserSqliteProgressEvent(progress));
          },
        },
      );
    } finally {
      if (activeImport === importRecord) activeImport = null;
    }
  }

  function closeDatabase() {
    if (!database) return { closed: false };
    const closed = closeBrowserSqliteDatabase(database);
    database = null;
    return { closed };
  }

  return Object.freeze({ handleMessage });
}

function createInitializationResult(database, reused) {
  return {
    initialized: true,
    reused,
    databaseStorage: 'memory',
    schemaVersion: getBrowserSqliteSchemaVersion(database),
  };
}

function requireDatabase(database) {
  if (database) return database;
  throw new BrowserSqliteWorkerRuntimeError(
    'database-not-initialized',
    'The temporary database is not initialized.',
  );
}

function selectSafeErrorCode(error, operation) {
  const code = typeof error?.code === 'string' ? error.code : null;
  if (SAFE_RUNTIME_ERROR_CODES.has(code)) return code;
  if (operation === BROWSER_SQLITE_OPERATIONS.INITIALIZE) {
    return 'initialization-failed';
  }
  if (operation === BROWSER_SQLITE_OPERATIONS.IMPORT_FILES) {
    return 'import-failed';
  }
  return 'operation-failed';
}

function extractUsableRequestId(message) {
  try {
    const value = message?.requestId;
    if (typeof value !== 'string') return null;
    const requestId = value.trim();
    return requestId && requestId.length <= 256 ? requestId : null;
  } catch {
    return null;
  }
}

export class BrowserSqliteWorkerRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteWorkerRuntimeError';
    this.code = code;
  }
}
