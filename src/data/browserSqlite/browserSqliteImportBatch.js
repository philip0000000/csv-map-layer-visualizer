import {
  BrowserSqliteImporterError,
  importBrowserSqliteCsvFile,
} from './browserSqliteImporter.js';
import { MAX_BROWSER_SQLITE_IMPORT_FILES } from './browserSqliteProtocol.js';

export { MAX_BROWSER_SQLITE_IMPORT_FILES };

/** Default minimum delay between non-terminal parsing/storage progress events. */
export const BROWSER_SQLITE_IMPORT_PROGRESS_INTERVAL_MS = 100;

/**
 * Import a bounded browser CSV file list sequentially into one worker database.
 *
 * Every file delegates to the single-file importer and therefore owns one
 * transaction. File failures are recorded without discarding earlier commits.
 * Cancellation stops the active file cooperatively and leaves later files
 * unopened. Progress never contains source rows.
 *
 * @param {object} database Initialized temporary sql.js database.
 * @param {File[]} files Browser CSV files, processed in supplied order.
 * @param {object} [options] Internal worker orchestration options.
 * @returns {Promise<object>} Small batch result with per-file metadata.
 */
export async function importBrowserSqliteCsvBatch(
  database,
  files,
  options = {},
) {
  const normalizedFiles = normalizeFiles(files);
  const settings = normalizeBatchOptions(options);
  const reportProgress = createProgressReporter(settings);
  const results = [];
  let canceled = false;

  for (let index = 0; index < normalizedFiles.length; index += 1) {
    reportProgress(createProgressEvent(
      settings.importId,
      normalizedFiles[index].fileName,
      index,
      normalizedFiles.length,
      'queued',
    ), true);
  }

  for (let index = 0; index < normalizedFiles.length; index += 1) {
    const fileEntry = normalizedFiles[index];
    if (isCancellationRequested(settings.shouldCancel)) {
      canceled = true;
      break;
    }

    reportProgress(createProgressEvent(
      settings.importId,
      fileEntry.fileName,
      index,
      normalizedFiles.length,
      'started',
    ), true);

    try {
      const datasetId = settings.createDatasetId?.(
        fileEntry.file,
        index + 1,
        settings.importId,
      );
      const imported = await importBrowserSqliteCsvFile(
        database,
        fileEntry.file,
        {
          datasetId,
          chunkSizeBytes: settings.chunkSizeBytes,
          batchSize: settings.batchSize,
          now: settings.now,
          shouldCancel: settings.shouldCancel,
          yieldControl: settings.yieldControl,
          onProgress: (progress) => {
            const state = progress.phase === 'storing' ? 'storing' : 'parsing';
            const completedRows = state === 'storing'
              ? progress.completedRows
              : progress.parsedRows;
            reportProgress(createProgressEvent(
              settings.importId,
              fileEntry.fileName,
              index,
              normalizedFiles.length,
              state,
              completedRows,
            ));
          },
        },
      );
      const result = normalizeSuccessfulFileResult(imported, fileEntry.fileName);
      results.push(result);
      reportProgress(createProgressEvent(
        settings.importId,
        fileEntry.fileName,
        index,
        normalizedFiles.length,
        'completed',
        result.rowCount,
        result.rowCount,
        true,
      ), true);
    } catch (error) {
      const fileCanceled = isCanceledError(error) ||
        isCancellationRequested(settings.shouldCancel);
      const result = createFailedFileResult(fileEntry.fileName, fileCanceled);
      results.push(result);
      reportProgress(createProgressEvent(
        settings.importId,
        fileEntry.fileName,
        index,
        normalizedFiles.length,
        'completed',
        0,
        null,
        false,
      ), true);

      if (fileCanceled) {
        canceled = true;
        break;
      }
    }
  }

  const successfulCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - successfulCount;
  const ok = !canceled && successfulCount > 0;

  return {
    ok,
    importId: settings.importId,
    canceled,
    successfulCount,
    failedCount,
    results,
    error: ok ? null : createBatchError(canceled),
  };
}

function normalizeFiles(files) {
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > MAX_BROWSER_SQLITE_IMPORT_FILES
  ) {
    throw new BrowserSqliteImportBatchError(
      'invalid-file-batch',
      `A file batch must contain 1 to ${MAX_BROWSER_SQLITE_IMPORT_FILES} browser files.`,
    );
  }

  return files.map((file, index) => ({
    file,
    fileName: getSafeFileName(file, index + 1),
  }));
}

function normalizeBatchOptions(options) {
  if (!isRecord(options)) {
    throw new BrowserSqliteImportBatchError(
      'invalid-batch-options',
      'Import batch options must be an object.',
    );
  }

  return {
    importId: normalizeImportId(options.importId),
    shouldCancel: normalizeOptionalCallback(
      options.shouldCancel,
      () => false,
      'cancellation check',
    ),
    onProgress: normalizeOptionalCallback(
      options.onProgress,
      null,
      'progress listener',
    ),
    progressIntervalMs: normalizeProgressInterval(options.progressIntervalMs),
    progressNow: normalizeOptionalCallback(
      options.progressNow,
      defaultProgressNow,
      'progress clock',
    ),
    createDatasetId: normalizeOptionalCallback(
      options.createDatasetId,
      null,
      'dataset ID factory',
    ),
    chunkSizeBytes: options.chunkSizeBytes,
    batchSize: options.batchSize,
    now: options.now,
    yieldControl: options.yieldControl,
  };
}

function createProgressReporter(settings) {
  let lastIncrementalAt = Number.NEGATIVE_INFINITY;

  return (progress, force = false) => {
    if (!settings.onProgress) return false;
    const incremental = progress.state === 'parsing' || progress.state === 'storing';
    const currentTime = readProgressTime(settings.progressNow);
    if (
      incremental &&
      !force &&
      currentTime - lastIncrementalAt < settings.progressIntervalMs
    ) {
      return false;
    }

    if (incremental) lastIncrementalAt = currentTime;
    try {
      settings.onProgress(progress);
    } catch {
      // Progress listeners cannot change transaction or batch outcomes.
    }
    return true;
  };
}

function createProgressEvent(
  importId,
  fileName,
  fileIndex,
  totalFiles,
  state,
  completedRows = null,
  totalRows = null,
  ok = null,
) {
  return {
    importId,
    state,
    fileName,
    fileNumber: fileIndex + 1,
    totalFiles,
    completedRows,
    totalRows,
    ok: state === 'completed' ? ok === true : null,
  };
}

function normalizeSuccessfulFileResult(value, fileName) {
  return {
    ok: true,
    fileName,
    datasetId: normalizeNullableId(value.datasetId),
    rowCount: normalizeCount(value.rowCount),
    importedFeatureCount: normalizeCount(value.importedFeatureCount),
    skippedRowCount: normalizeCount(value.skippedRowCount),
    warnings: Array.isArray(value.warnings) ? [...value.warnings] : [],
    detectedFields: isRecord(value.detectedFields)
      ? { ...value.detectedFields }
      : null,
    error: null,
  };
}

function createFailedFileResult(fileName, canceled) {
  return {
    ok: false,
    fileName,
    datasetId: null,
    rowCount: 0,
    importedFeatureCount: 0,
    skippedRowCount: 0,
    warnings: [],
    detectedFields: null,
    error: {
      code: canceled ? 'import-canceled' : 'import-failed',
      message: canceled
        ? 'Import canceled.'
        : 'The CSV file could not be imported.',
    },
  };
}

function createBatchError(canceled) {
  return {
    code: canceled ? 'import-canceled' : 'import-failed',
    message: canceled ? 'Import canceled.' : 'No CSV files were imported.',
  };
}

function getSafeFileName(file, fileNumber) {
  if (typeof file?.name === 'string' && file.name.trim()) {
    return file.name.trim().split(/[\\/]/).pop() || `CSV file ${fileNumber}`;
  }
  return `CSV file ${fileNumber}`;
}

function normalizeImportId(value) {
  if (value != null) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BrowserSqliteImportBatchError(
      'invalid-batch-options',
      'The import ID must be a non-empty string.',
    );
  }

  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `import-${randomUUID.call(globalThis.crypto)}`;
  }
  throw new BrowserSqliteImportBatchError(
    'import-id-unavailable',
    'A secure browser import ID could not be generated.',
  );
}

function normalizeOptionalCallback(value, fallback, label) {
  if (value == null) return fallback;
  if (typeof value === 'function') return value;
  throw new BrowserSqliteImportBatchError(
    'invalid-batch-options',
    `The ${label} must be a function.`,
  );
}

function normalizeProgressInterval(value) {
  if (value == null) return BROWSER_SQLITE_IMPORT_PROGRESS_INTERVAL_MS;
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new BrowserSqliteImportBatchError(
      'invalid-batch-options',
      'The progress interval must be an integer from 0 to 60000.',
    );
  }
  return value;
}

function defaultProgressNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function readProgressTime(progressNow) {
  try {
    const value = Number(progressNow());
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

function isCancellationRequested(shouldCancel) {
  try {
    return shouldCancel() === true;
  } catch {
    return true;
  }
}

function isCanceledError(error) {
  return error instanceof BrowserSqliteImporterError &&
    error.code === 'csv-import-canceled';
}

function normalizeNullableId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class BrowserSqliteImportBatchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteImportBatchError';
    this.code = code;
  }
}
