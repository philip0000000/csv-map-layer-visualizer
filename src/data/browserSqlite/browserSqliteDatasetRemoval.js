/**
 * Transactionally remove one completely imported dataset and its source rows.
 *
 * Foreign-key cascading performs the row deletion inside the same transaction.
 * A failure rolls back the entire operation so no partial dataset state remains.
 *
 * @param {{ prepare: Function, run: Function }} database sql.js database.
 * @param {string} datasetId Stable dataset identifier.
 * @returns {object} Backend-neutral dataset mutation input.
 */
export function removeBrowserSqliteDataset(database, datasetId) {
  requireDatabase(database);
  const normalizedId = normalizeRequiredDatasetId(datasetId);

  if (!hasCompleteDataset(database, normalizedId)) {
    throw new BrowserSqliteRemovalError(
      'dataset-not-found',
      'The requested dataset is unavailable.',
    );
  }

  let transactionStarted = false;

  try {
    database.run('BEGIN TRANSACTION');
    transactionStarted = true;
    database.run(`
      DELETE FROM datasets
      WHERE id = ? AND import_state = 'complete'
    `, [normalizedId]);
    database.run('COMMIT');
    transactionStarted = false;
  } catch {
    if (transactionStarted) {
      try {
        database.run('ROLLBACK');
      } catch {
        // Preserve the safe removal failure if SQLite already rolled back.
      }
    }
    throw new BrowserSqliteRemovalError(
      'dataset-removal-failed',
      'The dataset could not be removed.',
    );
  }

  return {
    ok: true,
    datasetId: normalizedId,
    changed: true,
    dataset: null,
    error: null,
  };
}

function hasCompleteDataset(database, datasetId) {
  const statement = database.prepare(`
    SELECT 1
    FROM datasets
    WHERE id = ? AND import_state = 'complete'
  `);

  try {
    statement.bind([datasetId]);
    return statement.step();
  } finally {
    statement.free();
  }
}

function normalizeRequiredDatasetId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new BrowserSqliteRemovalError(
    'invalid-dataset-mutation',
    'A dataset ID is required.',
  );
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

export class BrowserSqliteRemovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteRemovalError';
    this.code = code;
  }
}
