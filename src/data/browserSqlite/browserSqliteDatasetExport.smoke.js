import assert from 'node:assert/strict';
import Papa from 'papaparse';
import initSqlJs from 'sql.js';
import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
} from './browserSqliteDatabase.js';
import { exportBrowserSqliteDatasetCsv } from './browserSqliteDatasetExport.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  const headers = [
    'featureType', 'featureId', 'part', 'order', 'lat', 'lon', 'name', 'empty',
  ];
  insertDataset(database, 'selected', 'loaded-data', headers, 3);
  insertDataset(database, 'other', 'other.csv', ['name'], 1);
  insertRows(database, 'selected', [
    {
      featureType: 'region', featureId: 'zone-1', part: 'main', order: '0',
      lat: '60.25', lon: '19.5', name: 'Malmö, "old"\nquarter', empty: '',
    },
    {
      featureType: 'region', featureId: 'zone-1', part: 'island', order: '1',
      lat: '61', lon: '20', name: 'Island', empty: '',
    },
    {
      featureType: 'marker', featureId: 'marker-1', part: '', order: '',
      lat: '59', lon: '18', name: 'Marker', empty: '',
    },
  ]);
  insertRows(database, 'other', [{ name: 'must-not-export' }]);

  const exported = exportBrowserSqliteDatasetCsv(database, 'selected');
  assert.equal(exported.datasetId, 'selected');
  assert.equal(exported.fileName, 'loaded-data.csv');
  assert.equal(exported.csvText.includes('must-not-export'), false);
  assert.equal(exported.csvText.includes('dataset_id'), false);
  assert.equal(exported.csvText.includes('source_row_index'), false);

  const parsed = Papa.parse(exported.csvText, { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.meta.fields, headers);
  assert.deepEqual(parsed.data, [
    {
      featureType: 'region', featureId: 'zone-1', part: 'main', order: '0',
      lat: '60.25', lon: '19.5', name: 'Malmö, "old"\nquarter', empty: '',
    },
    {
      featureType: 'region', featureId: 'zone-1', part: 'island', order: '1',
      lat: '61', lon: '20', name: 'Island', empty: '',
    },
    {
      featureType: 'marker', featureId: 'marker-1', part: '', order: '',
      lat: '59', lon: '18', name: 'Marker', empty: '',
    },
  ]);

  assert.throws(
    () => exportBrowserSqliteDatasetCsv(database, 'missing'),
    (error) => error?.code === 'dataset-not-found',
  );
} finally {
  closeBrowserSqliteDatabase(database);
}

console.log('Browser SQLite dataset CSV export smoke test passed.');

/** Insert complete dataset metadata using the same stored header representation as import. */
function insertDataset(target, id, fileName, headers, rowCount) {
  target.run(`
    INSERT INTO datasets (
      id, file_name, columns_json, total_parsed_row_count, stored_row_count,
      skipped_row_count, import_state, imported_at
    ) VALUES (?, ?, ?, ?, ?, 0, 'complete', '2026-08-09T00:00:00.000Z')
  `, [id, fileName, JSON.stringify(headers), rowCount, rowCount]);
}

/** Insert source rows in the order the export must preserve. */
function insertRows(target, datasetId, rows) {
  const statement = target.prepare(`
    INSERT INTO source_rows (dataset_id, source_row_index, row_json)
    VALUES (?, ?, ?)
  `);
  try {
    rows.forEach((row, index) => statement.run([datasetId, index, JSON.stringify(row)]));
  } finally {
    statement.free();
  }
}
