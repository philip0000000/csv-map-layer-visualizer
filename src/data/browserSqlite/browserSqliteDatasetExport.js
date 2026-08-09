import Papa from 'papaparse';

/** Reconstruct one complete browser dataset from committed source rows. */
export function exportBrowserSqliteDatasetCsv(database, datasetId) {
  requireDatabase(database);
  const normalizedId = normalizeRequiredString(datasetId);
  const dataset = readOne(database, `
    SELECT file_name, columns_json
    FROM datasets
    WHERE id = ? AND import_state = 'complete'
  `, [normalizedId]);

  if (!dataset) throw datasetExportError('dataset-not-found');

  const headers = parseHeaders(dataset.columns_json);
  const storedRows = readAll(database, `
    SELECT row_json
    FROM source_rows
    WHERE dataset_id = ?
    ORDER BY source_row_index
  `, [normalizedId]);

  // Zone commits update the original coordinate keys in row_json. Header-driven
  // arrays therefore preserve those coordinates and omit every SQLite field.
  const rows = storedRows.map((stored) => {
    const row = parseStoredRow(stored.row_json);
    return headers.map((header) => row[header] ?? '');
  });

  return {
    datasetId: normalizedId,
    fileName: ensureCsvExtension(dataset.file_name),
    csvText: Papa.unparse({ fields: headers, data: rows }),
  };
}

/** Read one metadata row without exposing a live statement. */
function readOne(database, sql, parameters) {
  return readAll(database, sql, parameters, 1)[0] ?? null;
}

/** Read ordered sql.js rows and always release the prepared statement. */
function readAll(database, sql, parameters = [], maximumRows = Infinity) {
  const statement = database.prepare(sql);
  const rows = [];
  try {
    statement.bind(parameters);
    while (rows.length < maximumRows && statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

/** Parse the persisted import-time header order used for serialization. */
function parseHeaders(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    if (
      Array.isArray(parsed)
      && parsed.length > 0
      && parsed.every((header) => typeof header === 'string' && header.length > 0)
    ) return parsed;
  } catch {
    // Invalid stored metadata is reported as one safe export failure below.
  }
  throw datasetExportError('operation-failed');
}

/** Parse one complete source row and reject corrupted non-object JSON. */
function parseStoredRow(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Invalid stored row data is reported as one safe export failure below.
  }
  throw datasetExportError('operation-failed');
}

/** Keep the imported display name while ensuring a usable CSV download name. */
function ensureCsvExtension(value) {
  const fileName = normalizeRequiredString(value);
  return /\.csv$/i.test(fileName) ? fileName : `${fileName}.csv`;
}

/** Normalize dataset metadata and reject empty identifiers or filenames. */
function normalizeRequiredString(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw datasetExportError('operation-failed');
}

/** Require the narrow sql.js surface needed by the export query. */
function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A sql.js database with prepare() is required.');
  }
}

/** Create a worker-safe error code without attaching SQLite details. */
function datasetExportError(code) {
  return Object.assign(new Error('The selected CSV dataset could not be exported.'), { code });
}
