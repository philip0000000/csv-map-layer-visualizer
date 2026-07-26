import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
} from './browserSqliteDatabase.js';
import {
  getBrowserSqliteDatasetSummary,
} from './browserSqliteDatasetQueries.js';
import {
  BrowserSqliteMutationError,
  setBrowserSqliteDatasetEnabled,
  updateBrowserSqliteDatasetMapping,
} from './browserSqliteDatasetMutations.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  insertDataset(database, {
    id: 'dataset-a',
    fileName: 'a.csv',
    headers: ['name', 'lat', 'lon', 'lng', 'year'],
    detectedFields: {
      latField: 'lat',
      lonField: 'lon',
      yearField: 'year',
      dateField: null,
    },
    mapping: { latField: 'lat', lonField: 'lon' },
  });
  insertDataset(database, {
    id: 'dataset-b',
    fileName: 'b.csv',
    headers: ['name', 'latitude', 'longitude'],
    detectedFields: {
      latField: 'latitude',
      lonField: 'longitude',
      yearField: null,
      dateField: null,
    },
    mapping: { latField: 'latitude', lonField: 'longitude' },
  });
  insertDataset(database, {
    id: 'dataset-importing',
    fileName: 'importing.csv',
    headers: ['lat', 'lon'],
    detectedFields: { latField: 'lat', lonField: 'lon' },
    mapping: { latField: 'lat', lonField: 'lon' },
    importState: 'importing',
  });

  const disabled = setBrowserSqliteDatasetEnabled(database, 'dataset-a', false);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.changed, true);
  assert.equal(disabled.dataset.enabled, false);
  assert.equal(readEnabled(database, 'dataset-a'), 0);
  assert.equal(readEnabled(database, 'dataset-b'), 1);

  const unchanged = setBrowserSqliteDatasetEnabled(
    database,
    'dataset-a',
    false,
  );
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.equal(readEnabled(database, 'dataset-b'), 1);

  assertMutationError(
    () => setBrowserSqliteDatasetEnabled(database, 'dataset-a', 0),
    'invalid-dataset-mutation',
  );
  assert.equal(readEnabled(database, 'dataset-a'), 0);
  assertMutationError(
    () => setBrowserSqliteDatasetEnabled(database, 'missing', true),
    'dataset-not-found',
  );
  assertMutationError(
    () => setBrowserSqliteDatasetEnabled(
      database,
      'dataset-importing',
      false,
    ),
    'dataset-not-found',
  );

  const remapped = updateBrowserSqliteDatasetMapping(
    database,
    'dataset-a',
    { lonField: 'lng' },
  );
  assert.equal(remapped.ok, true);
  assert.deepEqual(remapped.mapping, {
    latField: 'lat',
    lonField: 'lng',
  });
  assert.equal(remapped.dataset.latField, 'lat');
  assert.equal(remapped.dataset.lonField, 'lng');
  assert.deepEqual(remapped.detectedFields, {
    latField: 'lat',
    lonField: 'lon',
    yearField: 'year',
    dateField: null,
  });

  const cleared = updateBrowserSqliteDatasetMapping(
    database,
    'dataset-a',
    { latField: null },
  );
  assert.deepEqual(cleared.mapping, {
    latField: null,
    lonField: 'lng',
  });
  assert.deepEqual(readMapping(database, 'dataset-a'), {
    latField: null,
    lonField: 'lng',
  });

  const clearedWithBlank = updateBrowserSqliteDatasetMapping(
    database,
    'dataset-a',
    { lonField: '  ' },
  );
  assert.deepEqual(clearedWithBlank.mapping, {
    latField: null,
    lonField: null,
  });

  const mappingBeforeFailures = readMapping(database, 'dataset-a');
  assertMutationError(
    () => updateBrowserSqliteDatasetMapping(
      database,
      'dataset-a',
      { latField: 'missing' },
    ),
    'invalid-mapping',
  );
  assertMutationError(
    () => updateBrowserSqliteDatasetMapping(
      database,
      'dataset-a',
      { lonField: 42 },
    ),
    'invalid-mapping',
  );
  assertMutationError(
    () => updateBrowserSqliteDatasetMapping(database, 'dataset-a', []),
    'invalid-mapping',
  );
  assertMutationError(
    () => updateBrowserSqliteDatasetMapping(database, 'missing', {}),
    'dataset-not-found',
  );
  assert.deepEqual(readMapping(database, 'dataset-a'), mappingBeforeFailures);

  const summary = getBrowserSqliteDatasetSummary(database);
  const datasetA = summary.datasets.find((dataset) => dataset.id === 'dataset-a');
  const datasetB = summary.datasets.find((dataset) => dataset.id === 'dataset-b');
  assert.equal(datasetA.enabled, false);
  assert.equal(datasetA.latField, null);
  assert.equal(datasetA.lonField, null);
  assert.equal(datasetB.enabled, true);
  assert.equal(datasetB.latField, 'latitude');
  assert.equal(datasetB.lonField, 'longitude');
} finally {
  closeBrowserSqliteDatabase(database);
}

console.log('Browser SQLite visibility and mapping mutation smoke test passed.');

function insertDataset(targetDatabase, fixture) {
  const importState = fixture.importState ?? 'complete';
  targetDatabase.run(`
    INSERT INTO datasets (
      id,
      file_name,
      columns_json,
      detected_fields_json,
      coordinate_mapping_json,
      import_state,
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    fixture.id,
    fixture.fileName,
    JSON.stringify(fixture.headers),
    JSON.stringify(fixture.detectedFields),
    JSON.stringify(fixture.mapping),
    importState,
    importState === 'complete' ? '2026-07-26T12:00:00.000Z' : null,
  ]);
}

function readEnabled(targetDatabase, datasetId) {
  return readValue(
    targetDatabase,
    'SELECT enabled FROM datasets WHERE id = ?',
    datasetId,
  );
}

function readMapping(targetDatabase, datasetId) {
  const value = readValue(
    targetDatabase,
    'SELECT coordinate_mapping_json FROM datasets WHERE id = ?',
    datasetId,
  );
  return JSON.parse(value);
}

function readValue(targetDatabase, sql, parameter) {
  const statement = targetDatabase.prepare(sql);
  try {
    statement.bind([parameter]);
    return statement.step() ? statement.get()[0] : null;
  } finally {
    statement.free();
  }
}

function assertMutationError(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof BrowserSqliteMutationError &&
    error.code === code &&
    !String(error.message).includes('UPDATE')
  ));
}
