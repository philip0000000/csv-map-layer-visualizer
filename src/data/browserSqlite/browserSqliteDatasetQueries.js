import { DEFAULT_PREVIEW_ROWS_LIMIT } from '../dataSource.js';

/** Worker-side ceiling that keeps every source-row preview response bounded. */
export const MAX_BROWSER_SQLITE_PREVIEW_LIMIT = 200;

/**
 * Return lightweight metadata for every completely imported dataset.
 *
 * Complete source rows stay in `source_rows`; this query reads only dataset
 * metadata and safely falls back when stored JSON has an unexpected shape.
 *
 * @param {{ prepare: (sql: string) => object }} database sql.js database.
 * @returns {object} Backend-neutral dataset summary input.
 */
export function getBrowserSqliteDatasetSummary(database) {
  const rows = readAll(database, `
    SELECT
      id,
      file_name,
      size_bytes,
      columns_json,
      total_parsed_row_count,
      stored_row_count,
      skipped_row_count,
      enabled,
      detected_fields_json,
      coordinate_mapping_json,
      warnings_json,
      imported_at
    FROM datasets
    WHERE import_state = 'complete'
    ORDER BY imported_at DESC, id
  `);

  return {
    datasets: rows.map((row) => {
      const mapping = parseJsonObject(row.coordinate_mapping_json);

      return {
        id: String(row.id),
        name: String(row.file_name),
        enabled: Number(row.enabled) === 1,
        headers: parseJsonStringList(row.columns_json),
        rowCount: normalizeStoredCount(row.stored_row_count),
        totalRows: normalizeStoredCount(row.total_parsed_row_count),
        sizeBytes: normalizeNullableStoredCount(row.size_bytes),
        importedFeatureCount: 0,
        skippedRowCount: normalizeStoredCount(row.skipped_row_count),
        importedAt: normalizeNullableString(row.imported_at),
        latField: normalizeNullableString(mapping.latField),
        lonField: normalizeNullableString(mapping.lonField),
        detectedFields: parseJsonObject(row.detected_fields_json),
        parseErrors: parseJsonStringList(row.warnings_json),
      };
    }),
    selectedDatasetId: null,
    timeline: null,
  };
}

/**
 * Return one bounded page of complete original rows in stable source order.
 *
 * Offset and limit are validated before SQL is prepared. Requests above the
 * worker-side maximum are clamped so a caller cannot pull a complete dataset
 * into main-thread state with one preview operation.
 *
 * @param {{ prepare: (sql: string) => object }} database sql.js database.
 * @param {{ datasetId: string, offset?: number, limit?: number }} query Page request.
 * @returns {object} Backend-neutral preview page input.
 */
export function getBrowserSqlitePreviewPage(database, query = {}) {
  const datasetId = normalizeRequiredId(query.datasetId);
  const offset = normalizePreviewInteger(query.offset, 0, {
    allowZero: true,
    field: 'offset',
  });
  const requestedLimit = normalizePreviewInteger(
    query.limit,
    DEFAULT_PREVIEW_ROWS_LIMIT,
    { allowZero: false, field: 'limit' },
  );
  const limit = Math.min(requestedLimit, MAX_BROWSER_SQLITE_PREVIEW_LIMIT);
  const dataset = readOne(database, `
    SELECT stored_row_count
    FROM datasets
    WHERE id = ? AND import_state = 'complete'
  `, [datasetId]);

  if (!dataset) {
    throw new BrowserSqliteQueryError(
      'dataset-not-found',
      'The requested dataset is unavailable.',
    );
  }

  const rows = readAll(database, `
    SELECT row_json
    FROM source_rows
    WHERE dataset_id = ?
    ORDER BY source_row_index
    LIMIT ? OFFSET ?
  `, [datasetId, limit, offset]);
  const totalRows = normalizeStoredCount(dataset.stored_row_count);

  return {
    datasetId,
    rows: rows.map((row) => parseJsonObject(row.row_json)),
    offset,
    limit,
    totalRows,
    hasMore: offset + rows.length < totalRows,
  };
}

function readOne(database, sql, parameters = []) {
  return readAll(database, sql, parameters, 1)[0] ?? null;
}

function readAll(
  database,
  sql,
  parameters = [],
  maximumRows = Number.POSITIVE_INFINITY,
) {
  requireDatabase(database);
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

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseJsonStringList(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeRequiredId(value) {
  const id = normalizeNullableString(value);
  if (id) return id;
  throw new BrowserSqliteQueryError(
    'invalid-preview-query',
    'A dataset ID is required.',
  );
}

function normalizePreviewInteger(value, fallback, { allowZero, field }) {
  if (value == null) return fallback;
  const number = Number(value);
  const minimum = allowZero ? 0 : 1;

  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new BrowserSqliteQueryError(
      'invalid-preview-query',
      `Preview ${field} must be an integer of at least ${minimum}.`,
    );
  }

  return number;
}

function normalizeStoredCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeNullableStoredCount(value) {
  return value == null ? null : normalizeStoredCount(value);
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A sql.js database with prepare() is required.');
  }
}

export class BrowserSqliteQueryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteQueryError';
    this.code = code;
  }
}
