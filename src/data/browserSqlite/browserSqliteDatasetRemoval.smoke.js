import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
} from './browserSqliteDatabase.js';
import {
  BrowserSqliteRemovalError,
  removeBrowserSqliteDataset,
} from './browserSqliteDatasetRemoval.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  insertDataset(database, 'dataset-a', 'a.csv', 'complete');
  insertSourceRows(database, 'dataset-a', 2);
  insertDataset(database, 'dataset-b', 'b.csv', 'complete');
  insertSourceRows(database, 'dataset-b', 1);
  insertDataset(database, 'dataset-c', 'c.csv', 'complete');
  insertSourceRows(database, 'dataset-c', 2);
  insertDataset(database, 'dataset-importing', 'importing.csv', 'importing');

  const removed = removeBrowserSqliteDataset(database, 'dataset-a');
  assert.deepEqual(removed, {
    ok: true,
    datasetId: 'dataset-a',
    changed: true,
    dataset: null,
    error: null,
  });
  assert.equal(countDatasets(database, 'dataset-a'), 0);
  assert.equal(countSourceRows(database, 'dataset-a'), 0);
  assert.equal(countDatasets(database, 'dataset-b'), 1);
  assert.equal(countSourceRows(database, 'dataset-b'), 1);
  assert.equal(countDatasets(database, 'dataset-c'), 1);
  assert.equal(countSourceRows(database, 'dataset-c'), 2);

  assertRemovalError(
    () => removeBrowserSqliteDataset(database, ''),
    'invalid-dataset-mutation',
  );
  assertRemovalError(
    () => removeBrowserSqliteDataset(database, 'missing'),
    'dataset-not-found',
  );
  assertRemovalError(
    () => removeBrowserSqliteDataset(database, 'dataset-importing'),
    'dataset-not-found',
  );
  assert.equal(countDatasets(database, 'dataset-importing'), 1);

  database.run(`
    CREATE TRIGGER prevent_dataset_c_removal
    BEFORE DELETE ON datasets
    WHEN OLD.id = 'dataset-c'
    BEGIN
      SELECT RAISE(ABORT, 'simulated removal failure');
    END
  `);
  assertRemovalError(
    () => removeBrowserSqliteDataset(database, 'dataset-c'),
    'dataset-removal-failed',
  );
  assert.equal(countDatasets(database, 'dataset-c'), 1);
  assert.equal(countSourceRows(database, 'dataset-c'), 2);
  assert.equal(countDatasets(database, 'dataset-b'), 1);
  assert.equal(countSourceRows(database, 'dataset-b'), 1);
  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);

  database.run('DROP TRIGGER prevent_dataset_c_removal');
  assert.equal(removeBrowserSqliteDataset(database, 'dataset-b').ok, true);
  assert.equal(removeBrowserSqliteDataset(database, 'dataset-c').ok, true);
  assert.equal(countCompleteDatasets(database), 0);
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM source_rows'), 0);
  assert.equal(countDatasets(database, 'dataset-importing'), 1);

  database.run(`
    UPDATE datasets
    SET import_state = 'complete',
        imported_at = '2026-07-26T12:00:00.000Z'
    WHERE id = 'dataset-importing'
  `);
  assert.equal(
    removeBrowserSqliteDataset(database, 'dataset-importing').ok,
    true,
  );
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM datasets'), 0);
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM source_rows'), 0);
  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);
} finally {
  closeBrowserSqliteDatabase(database);
}

console.log('Browser SQLite transactional dataset removal smoke test passed.');

function insertDataset(targetDatabase, id, fileName, importState) {
  targetDatabase.run(`
    INSERT INTO datasets (
      id,
      file_name,
      import_state,
      imported_at
    ) VALUES (?, ?, ?, ?)
  `, [
    id,
    fileName,
    importState,
    importState === 'complete' ? '2026-07-26T12:00:00.000Z' : null,
  ]);
}

function insertSourceRows(targetDatabase, datasetId, count) {
  const statement = targetDatabase.prepare(`
    INSERT INTO source_rows (dataset_id, source_row_index, row_json)
    VALUES (?, ?, ?)
  `);

  try {
    for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
      statement.run([
        datasetId,
        rowIndex,
        JSON.stringify({ name: `${datasetId} row ${rowIndex}` }),
      ]);
    }
  } finally {
    statement.free();
  }

  targetDatabase.run(`
    UPDATE datasets
    SET total_parsed_row_count = ?,
        stored_row_count = ?
    WHERE id = ?
  `, [count, count, datasetId]);
}

function countCompleteDatasets(targetDatabase) {
  return readScalar(
    targetDatabase,
    "SELECT COUNT(*) FROM datasets WHERE import_state = 'complete'",
  );
}

function countDatasets(targetDatabase, datasetId) {
  return readScalar(
    targetDatabase,
    'SELECT COUNT(*) FROM datasets WHERE id = ?',
    [datasetId],
  );
}

function countSourceRows(targetDatabase, datasetId) {
  return readScalar(
    targetDatabase,
    'SELECT COUNT(*) FROM source_rows WHERE dataset_id = ?',
    [datasetId],
  );
}

function readScalar(targetDatabase, sql, parameters = []) {
  const statement = targetDatabase.prepare(sql);
  try {
    statement.bind(parameters);
    return statement.step() ? statement.get()[0] : null;
  } finally {
    statement.free();
  }
}

function assertRemovalError(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof BrowserSqliteRemovalError &&
    error.code === code &&
    !String(error.message).includes('DELETE') &&
    !String(error.message).includes('simulated')
  ));
}
