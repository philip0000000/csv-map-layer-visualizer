import {
  getBrowserSqliteDatasetSummary,
} from './browserSqliteDatasetQueries.js';

/**
 * Enable or disable one completely imported dataset.
 *
 * The current value is read before updating so a valid no-op can report
 * `changed: false` without touching any other dataset.
 *
 * @param {{ prepare: (sql: string) => object, run: Function }} database sql.js database.
 * @param {string} datasetId Stable dataset identifier.
 * @param {boolean} enabled Requested visibility.
 * @returns {object} Backend-neutral dataset mutation input.
 */
export function setBrowserSqliteDatasetEnabled(
  database,
  datasetId,
  enabled,
) {
  const normalizedId = normalizeRequiredDatasetId(datasetId);
  if (typeof enabled !== 'boolean') {
    throw new BrowserSqliteMutationError(
      'invalid-dataset-mutation',
      'Dataset visibility must be a boolean.',
    );
  }

  const stored = requireCompleteDataset(database, normalizedId);
  const changed = (Number(stored.enabled) === 1) !== enabled;

  if (changed) {
    database.run(`
      UPDATE datasets
      SET enabled = ?
      WHERE id = ? AND import_state = 'complete'
    `, [enabled ? 1 : 0, normalizedId]);
  }

  return {
    ok: true,
    datasetId: normalizedId,
    changed,
    dataset: getSummaryItem(database, normalizedId),
    error: null,
  };
}

/**
 * Store the current latitude and longitude mapping for one dataset.
 *
 * Omitted fields retain their current value. Explicit null or blank values
 * clear one side of the mapping. Non-null fields must match normalized stored
 * headers. Detected coordinate and timeline metadata remains unchanged.
 *
 * @param {{ prepare: (sql: string) => object, run: Function }} database sql.js database.
 * @param {string} datasetId Stable dataset identifier.
 * @param {{ latField?: string|null, lonField?: string|null }} mapping Mapping update.
 * @returns {object} Backend-neutral mapping mutation input.
 */
export function updateBrowserSqliteDatasetMapping(
  database,
  datasetId,
  mapping,
) {
  const normalizedId = normalizeRequiredDatasetId(datasetId);
  if (!isRecord(mapping)) {
    throw new BrowserSqliteMutationError(
      'invalid-mapping',
      'Coordinate mapping must be an object.',
    );
  }

  const stored = requireCompleteDataset(database, normalizedId);
  const headers = new Set(parseJsonStringList(stored.columns_json));
  const current = parseJsonObject(stored.coordinate_mapping_json);
  const latField = Object.hasOwn(mapping, 'latField')
    ? normalizeMappingField(mapping.latField, 'latitude')
    : normalizeStoredMappingField(current.latField);
  const lonField = Object.hasOwn(mapping, 'lonField')
    ? normalizeMappingField(mapping.lonField, 'longitude')
    : normalizeStoredMappingField(current.lonField);

  requireKnownHeader(headers, latField, 'latitude');
  requireKnownHeader(headers, lonField, 'longitude');

  database.run(`
    UPDATE datasets
    SET coordinate_mapping_json = ?
    WHERE id = ? AND import_state = 'complete'
  `, [JSON.stringify({ latField, lonField }), normalizedId]);

  const dataset = getSummaryItem(database, normalizedId);
  return {
    ok: true,
    datasetId: normalizedId,
    mapping: { latField, lonField },
    detectedFields: dataset.detectedFields,
    dataset,
    error: null,
  };
}

function requireCompleteDataset(database, datasetId) {
  const dataset = readOne(database, `
    SELECT enabled, columns_json, coordinate_mapping_json
    FROM datasets
    WHERE id = ? AND import_state = 'complete'
  `, [datasetId]);

  if (dataset) return dataset;
  throw new BrowserSqliteMutationError(
    'dataset-not-found',
    'The requested dataset is unavailable.',
  );
}

function getSummaryItem(database, datasetId) {
  const dataset = getBrowserSqliteDatasetSummary(database).datasets
    .find((item) => item.id === datasetId);
  if (dataset) return dataset;
  throw new BrowserSqliteMutationError(
    'dataset-not-found',
    'The requested dataset is unavailable.',
  );
}

function readOne(database, sql, parameters) {
  requireDatabase(database);
  const statement = database.prepare(sql);

  try {
    statement.bind(parameters);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function normalizeRequiredDatasetId(value) {
  const datasetId = normalizeNullableString(value);
  if (datasetId) return datasetId;
  throw new BrowserSqliteMutationError(
    'invalid-dataset-mutation',
    'A dataset ID is required.',
  );
}

function normalizeMappingField(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new BrowserSqliteMutationError(
      'invalid-mapping',
      `The ${label} field must be a column name or null.`,
    );
  }
  return value.trim() || null;
}

function normalizeStoredMappingField(value) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function requireKnownHeader(headers, field, label) {
  if (field == null || headers.has(field)) return;
  throw new BrowserSqliteMutationError(
    'invalid-mapping',
    `The requested ${label} field is not a dataset column.`,
  );
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonStringList(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function requireDatabase(database) {
  if (
    !database ||
    typeof database.prepare !== 'function' ||
    typeof database.run !== 'function'
  ) {
    throw new TypeError('A sql.js database with prepare() and run() is required.');
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class BrowserSqliteMutationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteMutationError';
    this.code = code;
  }
}
