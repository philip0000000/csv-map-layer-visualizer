import Papa from 'papaparse';
import { readCsvTextChunks } from '../csvTextStream.js';
import { ImportReadError, readImportTextChunks } from '../importTextStream.js';
import { GeojsonValidationError, normalizeGeojsonFeature, validateGeojsonDocumentMetadata } from '../geojson.js';
import { GeojsonDocumentError, readGeojsonFeatures } from '../geojsonStream.js';
import { geojsonPropertyToCsv, resolveEmbeddedGeojson } from '../geojsonFeatureModel.js';
import { autoDetectLatLon } from '../../components/geoColumns.js';
import {
  autoDetectRangeFields,
  autoDetectTimelineFields,
} from '../../components/timeline.js';
import {
  collectCsvParserWarnings,
  csvRowToObject,
  isCsvRowEmpty,
  normalizeCsvHeaders,
  pushCsvWarning,
  warnForExtraCsvCells,
} from '../csvParsingCompatibility.js';
import {
  BrowserSqliteImportTransactionError,
  MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS,
  beginBrowserSqliteFileImport,
  completeBrowserSqliteFileImport,
  insertBrowserSqliteImportRowBatch,
  rollbackBrowserSqliteFileImport,
} from './browserSqliteImportTransaction.js';

/** Explicit PapaParse file-slice size used inside the SQLite worker. */
export const BROWSER_SQLITE_CSV_CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Default number of normalized rows retained before one SQLite storage call. */
export const BROWSER_SQLITE_CSV_ROW_BATCH_SIZE = 500;

const MAX_BROWSER_SQLITE_CSV_CHUNK_SIZE_BYTES = 16 * 1024 * 1024;

/**
 * Incrementally import one browser CSV/GeoJSON File, optionally gzip-compressed, into SQLite.
 *
 * Plain CSV uses PapaParse File slices; other formats share streaming transport.
 * Both paths use no nested parser worker. Normalized
 * rows are retained only until one bounded storage batch is inserted. The file
 * transaction commits only after parsing and metadata finalization succeed.
 *
 * @param {object} database Initialized temporary sql.js database.
 * @param {File|Blob} file Browser file with safe metadata and slice support.
 * @param {object} [options] Internal worker orchestration and test options.
 * @returns {Promise<object>} Small per-file result without source-row arrays.
 */
export function importBrowserSqliteCsvFile(database, file, options = {}) {
  const input = normalizeFileInput(file);
  const settings = normalizeImportOptions(options);
  const activeImport = beginBrowserSqliteFileImport(database, {
    datasetId: settings.datasetId,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    lastModifiedMs: input.lastModifiedMs,
  });
  const state = createParserState(
    activeImport,
    input.fileName,
    settings,
  );

  // Plain CSV keeps its established file-slice path; native GeoJSON and gzip
  // share bounded byte transport, the storage batches, and the file transaction.
  if (/\.(?:geojson(?:\.gz)?|csv\.gz)$/i.test(input.fileName)) {
    return importStreamedFile(activeImport, state, file, settings);
  }

  return new Promise((resolve, reject) => {
    const fail = (error, fallbackCode = 'csv-import-failed') => {
      if (state.settled) return;
      state.settled = true;
      state.pendingRows.length = 0;
      try {
        rollbackBrowserSqliteFileImport(activeImport);
      } catch {
        // Preserve the safe importer failure if SQLite already rolled back.
      }
      reject(normalizeImporterError(error, fallbackCode));
    };

    try {
      Papa.parse(file, {
        delimiter: '',
        skipEmptyLines: true,
        quoteChar: '"',
        escapeChar: '"',
        worker: false,
        chunkSize: settings.chunkSizeBytes,
        chunk: (result, parser) => {
          if (state.settled) return;
          try {
            parser.pause();
            void processPausedChunk(state, result, parser, fail);
          } catch (error) {
            fail(error);
            abortParser(parser);
          }
        },
        complete: async () => {
          if (state.settled) return;
          try {
            const result = await finalizeParsedFile(state);
            state.settled = true;
            resolve(result);
          } catch (error) {
            fail(error);
          }
        },
        error: (error) => {
          fail(error, 'csv-read-failed');
        },
      });
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Import gzip CSV or native GeoJSON without buffering the expanded document.
 * The transaction commits only after the gzip trailer and final document record have
 * been consumed; corruption or cancellation removes all rows from this file.
 */
async function importStreamedFile(activeImport, state, file, settings) {
  try {
    const text = (probe = false) => readImportTextChunks(readFileBytes(file, settings.chunkSizeBytes), {
      fileName: state.fileName,
      shouldCancel: settings.shouldCancel,
      onProgress: probe ? undefined : bytes => {
        state.readProgress = bytes;
        emitImporterProgress(state, 'reading');
      },
    });
    if (/\.geojson(?:\.gz)?$/i.test(state.fileName)) {
      state.headers = ['geometry', 'geometryInterpretation'];
      const headers = new Set(state.headers);
      for await (const value of readGeojsonFeatures(text, {
        shouldCancel: settings.shouldCancel,
        onCollectionStart: () => { state.isFeatureCollection = true; },
        onMetadata: metadata => {
          try { state.geojsonMetadata = validateGeojsonDocumentMetadata(metadata); }
          catch (error) { throw new GeojsonDocumentError(error.message); }
          state.sawParsedRows = true;
        },
      })) {
        state.sawParsedRows = true;
        state.totalParsedRowCount++;
        try {
          if (state.isFeatureCollection && value?.type !== 'Feature') {
            throw new GeojsonValidationError('FeatureCollection entries must be Features.');
          }
          const feature = normalizeGeojsonFeature(value);
          const row = Object.fromEntries(Object.entries(feature.properties ?? {}).map(([key, property]) => [key, geojsonPropertyToCsv(property)]));
          // Authoritative typed properties stay inside the Feature. Reserved CSV
          // columns cannot overwrite similarly named original GeoJSON properties.
          row.geometry = JSON.stringify(feature);
          row.geometryInterpretation = 'geojson';
          // A native Feature's custom featureType property is metadata, not a CSV declaration.
          delete row.featureType;
          Object.keys(row).forEach(key => headers.add(key));
          state.pendingRows.push(row);
          if (state.pendingRows.length >= state.batchSize) flushPendingRows(state);
        } catch (error) {
          if (!(error instanceof GeojsonValidationError)) throw error;
          state.skippedRowCount++;
          pushCsvWarning(state.warnings, `Skipped GeoJSON feature ${state.totalParsedRowCount}: ${error.message}`);
        }
        // Yield by batch so small Features do not each incur a timer round trip.
        if (state.totalParsedRowCount % state.batchSize === 0) {
          emitImporterProgress(state, 'parsing');
          await state.yieldControl();
        }
      }
      state.headers = [...headers];
    } else {
      for await (const result of readCsvTextChunks(text(), { shouldCancel: settings.shouldCancel })) {
        throwIfCanceled(state);
        processParsedChunk(state, result);
        emitImporterProgress(state, 'parsing');
        await state.yieldControl();
      }
    }
    const result = await finalizeParsedFile(state);
    state.settled = true;
    return result;
  } catch (error) {
    state.pendingRows.length = 0;
    state.settled = true;
    try { rollbackBrowserSqliteFileImport(activeImport); } catch { /* Preserve the read/import failure. */ }
    throw normalizeImporterError(error, 'csv-read-failed');
  }
}

/** Read bounded file slices as bytes; do not call File.text() or expand the whole file. */
async function* readFileBytes(file, chunkSizeBytes) {
  for (let offset = 0; offset < file.size; offset += chunkSizeBytes) {
    yield new Uint8Array(await file.slice(offset, offset + chunkSizeBytes).arrayBuffer());
  }
}

function createParserState(activeImport, fileName, settings) {
  return {
    activeImport,
    batchCount: 0,
    batchSize: settings.batchSize,
    fileName,
    headers: null,
    parsedLineNumber: 0,
    pendingRows: [],
    sawParsedRows: false,
    settled: false,
    skippedRowCount: 0,
    storedRowCount: 0,
    totalParsedRowCount: 0,
    warnings: [],
    now: settings.now,
    onProgress: settings.onProgress,
    shouldCancel: settings.shouldCancel,
    yieldControl: settings.yieldControl,
  };
}

async function processPausedChunk(state, result, parser, fail) {
  try {
    throwIfCanceled(state);
    processParsedChunk(state, result);
    emitImporterProgress(state, 'parsing');
    await state.yieldControl();
    throwIfCanceled(state);
    parser.resume();
  } catch (error) {
    fail(error);
    abortParser(parser);
  }
}

function processParsedChunk(state, result) {
  collectCsvParserWarnings(state.warnings, result?.errors);
  const rows = Array.isArray(result?.data) ? result.data : [];

  for (const row of rows) {
    state.sawParsedRows = true;
    state.parsedLineNumber += 1;
    processParsedRow(state, row);
  }
}

function processParsedRow(state, row) {
  if (!Array.isArray(row)) {
    if (state.headers) {
      state.totalParsedRowCount += 1;
      state.skippedRowCount += 1;
      pushCsvWarning(
        state.warnings,
        `Skipped non-row at line ${state.parsedLineNumber}.`,
      );
    }
    return;
  }

  if (isCsvRowEmpty(row)) return;

  if (!state.headers) {
    const headers = normalizeCsvHeaders(row);
    if (headers.length === 0) {
      pushCsvWarning(state.warnings, 'Header row is empty.');
      return;
    }
    state.headers = headers;
    return;
  }

  state.totalParsedRowCount += 1;
  warnForExtraCsvCells(
    row,
    state.headers,
    state.parsedLineNumber,
    state.warnings,
  );
  const normalized = csvRowToObject(row, state.headers);
  const compact = resolveEmbeddedGeojson(normalized);
  if (compact.kind === 'invalid') {
    state.skippedRowCount++;
    pushCsvWarning(state.warnings, `Skipped row ${state.parsedLineNumber}: ${compact.warning}`);
    return;
  }
  state.pendingRows.push(normalized);
  if (state.pendingRows.length >= state.batchSize) flushPendingRows(state);
}

function flushPendingRows(state) {
  if (state.pendingRows.length === 0) return;
  const stored = insertBrowserSqliteImportRowBatch(
    state.activeImport,
    state.pendingRows,
  );
  state.storedRowCount = stored.storedRowCount;
  state.batchCount += 1;
  state.pendingRows.length = 0;
  emitImporterProgress(state, 'storing');
}

async function finalizeParsedFile(state) {
  throwIfCanceled(state);
  if (!state.sawParsedRows) {
    throw new BrowserSqliteImporterError(
      'csv-empty',
      'The CSV file did not contain any rows.',
    );
  }
  if (!state.headers) {
    throw new BrowserSqliteImporterError(
      'csv-header-missing',
      'The CSV file did not contain a usable header row.',
    );
  }

  flushPendingRows(state);
  if (state.storedRowCount === 0) {
    pushCsvWarning(state.warnings, 'No usable data rows were parsed.');
  }

  const detectedFields = detectImportFields(state.headers);
  const importedAt = state.now();
  const committed = await completeBrowserSqliteFileImport(state.activeImport, {
    beforeCommit: async () => {
      emitImporterProgress(state, 'storing');
      await state.yieldControl();
      throwIfCanceled(state);
    },
    geojsonMetadata: state.geojsonMetadata,
    headers: state.headers,
    totalParsedRowCount: state.totalParsedRowCount,
    skippedRowCount: state.skippedRowCount,
    detectedFields,
    coordinateMapping: {
      latField: detectedFields.latField,
      lonField: detectedFields.lonField,
    },
    warnings: state.warnings,
    importedAt,
  });

  return {
    ok: true,
    fileName: state.fileName,
    datasetId: committed.datasetId,
    rowCount: committed.rowCount,
    totalParsedRowCount: committed.totalParsedRowCount,
    importedFeatureCount:
      committed.pointFeatureCount +
      committed.lineFeatureCount +
      committed.regionFeatureCount,
    skippedRowCount: committed.skippedRowCount,
    warnings: [...state.warnings],
    detectedFields,
    storedBatchCount: state.batchCount,
    importedAt: committed.importedAt,
  };
}

function detectImportFields(headers) {
  return {
    ...autoDetectLatLon(headers),
    ...autoDetectTimelineFields(headers),
    ...autoDetectRangeFields(headers),
  };
}

function normalizeFileInput(file) {
  if (
    !file ||
    typeof file !== 'object' ||
    typeof file.slice !== 'function' ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0
  ) {
    throw new BrowserSqliteImporterError(
      'invalid-csv-file',
      'A browser CSV File with bounded slice support is required.',
    );
  }

  const fileName = normalizeFileName(file.name);
  const mimeType = file.type == null ? null : normalizeOptionalString(file.type);
  const lastModifiedMs = file.lastModified == null
    ? null
    : normalizeOptionalCount(file.lastModified, 'last-modified time');

  return {
    fileName,
    sizeBytes: file.size,
    mimeType,
    lastModifiedMs,
  };
}

function normalizeImportOptions(options) {
  if (!isRecord(options)) {
    throw new BrowserSqliteImporterError(
      'invalid-import-options',
      'CSV import options must be an object.',
    );
  }

  return {
    datasetId: normalizeDatasetId(options.datasetId),
    chunkSizeBytes: normalizeBoundedInteger(
      options.chunkSizeBytes,
      BROWSER_SQLITE_CSV_CHUNK_SIZE_BYTES,
      1,
      MAX_BROWSER_SQLITE_CSV_CHUNK_SIZE_BYTES,
      'CSV chunk size',
    ),
    batchSize: normalizeBoundedInteger(
      options.batchSize,
      BROWSER_SQLITE_CSV_ROW_BATCH_SIZE,
      1,
      MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS,
      'CSV row batch size',
    ),
    now: normalizeClock(options.now),
    onProgress: normalizeOptionalCallback(options.onProgress, 'progress callback'),
    shouldCancel: normalizeCancellationCheck(options.shouldCancel),
    yieldControl: normalizeYieldControl(options.yieldControl),
  };
}

function normalizeDatasetId(value) {
  if (value != null) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BrowserSqliteImporterError(
      'invalid-import-options',
      'The dataset ID must be a non-empty string.',
    );
  }

  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `browser-${randomUUID.call(globalThis.crypto)}`;
  }
  throw new BrowserSqliteImporterError(
    'dataset-id-unavailable',
    'A secure browser dataset ID could not be generated.',
  );
}

function normalizeClock(value) {
  if (value == null) return () => new Date().toISOString();
  if (typeof value === 'function') return value;
  throw new BrowserSqliteImporterError(
    'invalid-import-options',
    'The import clock must be a function.',
  );
}

function normalizeOptionalCallback(value, label) {
  if (value == null) return null;
  if (typeof value === 'function') return value;
  throw new BrowserSqliteImporterError(
    'invalid-import-options',
    `The ${label} must be a function.`,
  );
}

function normalizeCancellationCheck(value) {
  if (value == null) return () => false;
  if (typeof value === 'function') return value;
  throw new BrowserSqliteImporterError(
    'invalid-import-options',
    'The cancellation check must be a function.',
  );
}

function normalizeYieldControl(value) {
  if (value == null) {
    return () => new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (typeof value === 'function') return value;
  throw new BrowserSqliteImporterError(
    'invalid-import-options',
    'The chunk yield callback must be a function.',
  );
}

function emitImporterProgress(state, phase) {
  try {
    state.onProgress?.({
      phase,
      completedRows: state.storedRowCount,
      parsedRows: state.totalParsedRowCount,
      storedBatchCount: state.batchCount,
      ...(state.readProgress ? { sourceBytes: state.readProgress.sourceBytes, expandedBytes: state.readProgress.expandedBytes } : {}),
    });
  } catch {
    // Progress listeners cannot alter the file transaction outcome.
  }
}

function throwIfCanceled(state) {
  let canceled = false;
  try {
    canceled = state.shouldCancel() === true;
  } catch {
    canceled = true;
  }
  if (canceled) {
    throw new BrowserSqliteImporterError(
      'csv-import-canceled',
      'The CSV import was canceled.',
    );
  }
}

function abortParser(parser) {
  try {
    parser.abort();
  } catch {
    // The transaction is already rolled back; parser cleanup is best effort.
  }
}

function normalizeFileName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BrowserSqliteImporterError(
      'invalid-csv-file',
      'The browser CSV File must have a display name.',
    );
  }
  const fileName = value.trim().split(/[\\/]/).pop()?.trim();
  if (fileName) return fileName;
  throw new BrowserSqliteImporterError(
    'invalid-csv-file',
    'The browser CSV File must have a display name.',
  );
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    throw new BrowserSqliteImporterError(
      'invalid-csv-file',
      'The browser CSV MIME type must be a string.',
    );
  }
  return value.trim() || null;
}

function normalizeOptionalCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BrowserSqliteImporterError(
      'invalid-csv-file',
      `The browser CSV ${label} must be a non-negative integer.`,
    );
  }
  return value;
}

function normalizeBoundedInteger(value, fallback, minimum, maximum, label) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BrowserSqliteImporterError(
      'invalid-import-options',
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function normalizeImporterError(error, fallbackCode) {
  if (error instanceof BrowserSqliteImporterError) return error;
  if (error?.code === 'csv-record-size-limit') return new BrowserSqliteImporterError(error.code, 'A CSV record exceeds the supported size limit.');
  if (error instanceof ImportReadError) {
    return new BrowserSqliteImporterError(error.code, error.message);
  }
  if (error instanceof GeojsonDocumentError) return new BrowserSqliteImporterError(error.code, error.message);
  if (error instanceof BrowserSqliteImportTransactionError) {
    return new BrowserSqliteImporterError(
      'csv-import-storage-failed',
      'The CSV file could not be stored in the temporary database.',
    );
  }
  return new BrowserSqliteImporterError(
    fallbackCode,
    fallbackCode === 'csv-read-failed'
      ? 'The CSV file could not be read.'
      : 'The CSV file could not be imported.',
  );
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class BrowserSqliteImporterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteImporterError';
    this.code = code;
  }
}
