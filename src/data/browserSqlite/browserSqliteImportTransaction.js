import { MAX_CSV_PARSE_WARNINGS } from '../csvParsingCompatibility.js';

/** Maximum already-normalized rows accepted by one storage call. */
export const MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS = 1_000;

const DETECTED_FIELD_KEYS = Object.freeze([
  'latField',
  'lonField',
  'yearField',
  'dateField',
  'dayOfYearField',
  'yearFromField',
  'yearToField',
  'dateFromField',
  'dateToField',
]);

const importHandles = new WeakMap();
const activeDatabaseImports = new WeakMap();

/**
 * Begin one file-scoped import transaction and create its provisional dataset.
 *
 * The returned opaque handle owns one reusable source-row insert statement.
 * Callers cannot supply source indexes; they are assigned in insertion order.
 *
 * @param {{ run: Function, prepare: Function }} database sql.js database.
 * @param {object} metadata Safe browser file and dataset metadata.
 * @returns {object} Opaque active file import handle.
 */
export function beginBrowserSqliteFileImport(database, metadata) {
  requireDatabase(database);
  if (activeDatabaseImports.has(database)) {
    throw new BrowserSqliteImportTransactionError(
      'import-already-active',
      'A file import transaction is already active.',
    );
  }

  const normalized = normalizeBeginMetadata(metadata);
  const handle = Object.freeze({});
  let transactionStarted = false;
  let insertStatement = null;

  try {
    database.run('BEGIN TRANSACTION');
    transactionStarted = true;
    database.run(`
      INSERT INTO datasets (
        id,
        file_name,
        size_bytes,
        mime_type,
        last_modified_ms,
        import_state
      ) VALUES (?, ?, ?, ?, ?, 'importing')
    `, [
      normalized.datasetId,
      normalized.fileName,
      normalized.sizeBytes,
      normalized.mimeType,
      normalized.lastModifiedMs,
    ]);
    insertStatement = database.prepare(`
      INSERT INTO source_rows (
        dataset_id,
        source_row_index,
        row_json
      ) VALUES (?, ?, ?)
    `);

    const state = {
      database,
      datasetId: normalized.datasetId,
      handle,
      insertStatement,
      nextSourceRowIndex: 0,
      status: 'active',
    };
    importHandles.set(handle, state);
    activeDatabaseImports.set(database, handle);
    return handle;
  } catch {
    freeStatement(insertStatement);
    if (transactionStarted) safeRollback(database);
    throw new BrowserSqliteImportTransactionError(
      'import-transaction-failed',
      'The file import transaction could not be started.',
    );
  }
}

/**
 * Insert one bounded batch of already-normalized row objects.
 *
 * A validation or SQLite failure aborts and rolls back the complete active
 * file, including rows inserted by earlier batches.
 *
 * @param {object} activeImport Opaque active file import handle.
 * @param {Array<Record<string, string>>} rows Bounded normalized row batch.
 * @returns {object} Small storage progress result without source rows.
 */
export function insertBrowserSqliteImportRowBatch(activeImport, rows) {
  const state = requireActiveImport(activeImport);

  try {
    validateRowBatch(rows);

    for (const row of rows) {
      state.insertStatement.run([
        state.datasetId,
        state.nextSourceRowIndex,
        JSON.stringify(row),
      ]);
      state.nextSourceRowIndex += 1;
    }

    return {
      datasetId: state.datasetId,
      insertedRowCount: rows.length,
      storedRowCount: state.nextSourceRowIndex,
    };
  } catch (error) {
    abortActiveImport(state);
    if (error instanceof BrowserSqliteImportTransactionError) throw error;
    throw new BrowserSqliteImportTransactionError(
      'import-storage-failed',
      'The CSV row batch could not be stored.',
    );
  }
}

/**
 * Finalize metadata, commit the active file, and release its statement.
 *
 * Stored row count is derived from successful inserts. Final counts must
 * reconcile before the provisional dataset can become visible as complete.
 *
 * @param {object} activeImport Opaque active file import handle.
 * @param {object} metadata Final headers, counts, detection, warnings, and time.
 * @returns {object} Small committed import result without source rows.
 */
export function completeBrowserSqliteFileImport(activeImport, metadata) {
  const state = requireActiveImport(activeImport);

  try {
    const normalized = normalizeCompletionMetadata(
      metadata,
      state.nextSourceRowIndex,
    );
    freeActiveStatement(state);
    state.database.run(`
      UPDATE datasets
      SET columns_json = ?,
          total_parsed_row_count = ?,
          stored_row_count = ?,
          skipped_row_count = ?,
          detected_fields_json = ?,
          coordinate_mapping_json = ?,
          warnings_json = ?,
          import_state = 'complete',
          imported_at = ?
      WHERE id = ? AND import_state = 'importing'
    `, [
      JSON.stringify(normalized.headers),
      normalized.totalParsedRowCount,
      state.nextSourceRowIndex,
      normalized.skippedRowCount,
      JSON.stringify(normalized.detectedFields),
      JSON.stringify(normalized.coordinateMapping),
      JSON.stringify(normalized.warnings),
      normalized.importedAt,
      state.datasetId,
    ]);

    if (state.database.getRowsModified() !== 1) {
      throw new Error('The provisional dataset was unavailable.');
    }

    state.database.run('COMMIT');
    finishActiveImport(state, 'complete');

    return {
      datasetId: state.datasetId,
      rowCount: state.nextSourceRowIndex,
      totalParsedRowCount: normalized.totalParsedRowCount,
      skippedRowCount: normalized.skippedRowCount,
      importedAt: normalized.importedAt,
    };
  } catch (error) {
    abortActiveImport(state);
    if (error instanceof BrowserSqliteImportTransactionError) throw error;
    throw new BrowserSqliteImportTransactionError(
      'import-finalization-failed',
      'The file import could not be finalized.',
    );
  }
}

/**
 * Roll back one active file import without affecting committed datasets.
 *
 * Repeated rollback calls for the same handle are harmless.
 *
 * @param {object} activeImport Opaque file import handle.
 * @returns {{ datasetId: string, rolledBack: boolean }} Rollback result.
 */
export function rollbackBrowserSqliteFileImport(activeImport) {
  const state = requireImportHandle(activeImport);
  if (state.status !== 'active') {
    return { datasetId: state.datasetId, rolledBack: false };
  }

  freeActiveStatement(state);
  const rolledBack = safeRollback(state.database);
  finishActiveImport(state, 'rolled-back');

  if (!rolledBack) {
    throw new BrowserSqliteImportTransactionError(
      'import-rollback-failed',
      'The file import could not be rolled back safely.',
    );
  }

  return { datasetId: state.datasetId, rolledBack: true };
}

function normalizeBeginMetadata(metadata) {
  if (!isRecord(metadata)) {
    throwInvalidMetadata('File import metadata must be an object.');
  }

  return {
    datasetId: normalizeRequiredString(
      metadata.datasetId,
      'A dataset ID is required.',
    ),
    fileName: normalizeFileName(metadata.fileName),
    sizeBytes: normalizeOptionalCount(metadata.sizeBytes, 'file size'),
    mimeType: normalizeOptionalString(metadata.mimeType, 'MIME type'),
    lastModifiedMs: normalizeOptionalCount(
      metadata.lastModifiedMs,
      'last-modified time',
    ),
  };
}

function normalizeCompletionMetadata(metadata, storedRowCount) {
  if (!isRecord(metadata)) {
    throwInvalidFinalization('Import completion metadata must be an object.');
  }

  const headers = normalizeHeaders(metadata.headers);
  const totalParsedRowCount = normalizeRequiredCount(
    metadata.totalParsedRowCount,
    'total parsed row count',
  );
  const skippedRowCount = normalizeRequiredCount(
    metadata.skippedRowCount,
    'skipped row count',
  );
  if (totalParsedRowCount !== storedRowCount + skippedRowCount) {
    throwInvalidFinalization(
      'Parsed, stored, and skipped row counts must reconcile.',
    );
  }

  const headerSet = new Set(headers);
  const detectedFields = normalizeDetectedFields(
    metadata.detectedFields,
    headerSet,
  );
  const coordinateMapping = normalizeCoordinateMapping(
    metadata.coordinateMapping,
    headerSet,
  );

  return {
    headers,
    totalParsedRowCount,
    skippedRowCount,
    detectedFields,
    coordinateMapping,
    warnings: normalizeWarnings(metadata.warnings),
    importedAt: normalizeImportedAt(metadata.importedAt),
  };
}

function normalizeHeaders(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throwInvalidFinalization('At least one normalized CSV header is required.');
  }

  const headers = value.map((header) => {
    if (typeof header !== 'string' || !header.trim()) {
      throwInvalidFinalization('CSV headers must be non-empty strings.');
    }
    if (header !== header.trim()) {
      throwInvalidFinalization('CSV headers must already be trimmed.');
    }
    return header;
  });

  if (new Set(headers).size !== headers.length) {
    throwInvalidFinalization('CSV headers must already be unique.');
  }
  return headers;
}

function normalizeDetectedFields(value, headers) {
  if (!isRecord(value)) {
    throwInvalidFinalization('Detected fields must be an object.');
  }

  const detectedFields = {};
  for (const key of DETECTED_FIELD_KEYS) {
    detectedFields[key] = normalizeHeaderReference(value[key], headers, key);
  }
  return detectedFields;
}

function normalizeCoordinateMapping(value, headers) {
  if (!isRecord(value)) {
    throwInvalidFinalization('Coordinate mapping must be an object.');
  }

  return {
    latField: normalizeHeaderReference(value.latField, headers, 'latField'),
    lonField: normalizeHeaderReference(value.lonField, headers, 'lonField'),
  };
}

function normalizeHeaderReference(value, headers, label) {
  if (value == null) return null;
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !headers.has(value)
  ) {
    throwInvalidFinalization(
      `The ${label} value must be null or a normalized CSV header.`,
    );
  }
  return value;
}

function normalizeWarnings(value) {
  if (!Array.isArray(value) || value.length > MAX_CSV_PARSE_WARNINGS) {
    throwInvalidFinalization(
      `Warnings must be an array capped at ${MAX_CSV_PARSE_WARNINGS} items.`,
    );
  }
  if (value.some((warning) => typeof warning !== 'string')) {
    throwInvalidFinalization('Import warnings must be strings.');
  }
  return [...value];
}

function normalizeImportedAt(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    throwInvalidFinalization('A valid import completion time is required.');
  }
  return value.trim();
}

function validateRowBatch(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS
  ) {
    throw new BrowserSqliteImportTransactionError(
      'invalid-row-batch',
      `A row batch must contain 1 to ${MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS} rows.`,
    );
  }

  for (const row of rows) {
    if (!isRecord(row)) {
      throwInvalidRowBatch();
    }
    for (const value of Object.values(row)) {
      if (typeof value !== 'string') throwInvalidRowBatch();
    }
  }
}

function throwInvalidRowBatch() {
  throw new BrowserSqliteImportTransactionError(
    'invalid-row-batch',
    'Every normalized CSV row must be an object containing string values.',
  );
}

function normalizeFileName(value) {
  const normalized = normalizeRequiredString(
    value,
    'A CSV file name is required.',
  );
  const fileName = normalized.split(/[\\/]/).pop()?.trim();
  if (fileName) return fileName;
  throwInvalidMetadata('A CSV file name is required.');
}

function normalizeRequiredString(value, message) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throwInvalidMetadata(message);
}

function normalizeOptionalString(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throwInvalidMetadata(`The ${label} must be a string or null.`);
  }
  return value.trim() || null;
}

function normalizeOptionalCount(value, label) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throwInvalidMetadata(`The ${label} must be a non-negative integer or null.`);
  }
  return value;
}

function normalizeRequiredCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throwInvalidFinalization(`The ${label} must be a non-negative integer.`);
  }
  return value;
}

function requireActiveImport(activeImport) {
  const state = requireImportHandle(activeImport);
  if (state.status !== 'active') {
    throw new BrowserSqliteImportTransactionError(
      'import-not-active',
      'The file import transaction is no longer active.',
    );
  }
  return state;
}

function requireImportHandle(activeImport) {
  if (
    !activeImport ||
    typeof activeImport !== 'object' ||
    !importHandles.has(activeImport)
  ) {
    throw new BrowserSqliteImportTransactionError(
      'invalid-import-handle',
      'A valid file import handle is required.',
    );
  }
  return importHandles.get(activeImport);
}

function abortActiveImport(state) {
  if (state.status !== 'active') return;
  freeActiveStatement(state);
  safeRollback(state.database);
  finishActiveImport(state, 'failed');
}

function finishActiveImport(state, status) {
  state.status = status;
  activeDatabaseImports.delete(state.database);
}

function freeActiveStatement(state) {
  freeStatement(state.insertStatement);
  state.insertStatement = null;
}

function freeStatement(statement) {
  try {
    statement?.free();
  } catch {
    // Cleanup must not replace the safe transaction error returned to callers.
  }
}

function safeRollback(database) {
  try {
    database.run('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

function requireDatabase(database) {
  if (
    !database ||
    typeof database.run !== 'function' ||
    typeof database.prepare !== 'function' ||
    typeof database.getRowsModified !== 'function'
  ) {
    throw new TypeError(
      'A sql.js database with run(), prepare(), and getRowsModified() is required.',
    );
  }
}

function throwInvalidMetadata(message) {
  throw new BrowserSqliteImportTransactionError(
    'invalid-import-metadata',
    message,
  );
}

function throwInvalidFinalization(message) {
  throw new BrowserSqliteImportTransactionError(
    'invalid-import-finalization',
    message,
  );
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class BrowserSqliteImportTransactionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteImportTransactionError';
    this.code = code;
  }
}
