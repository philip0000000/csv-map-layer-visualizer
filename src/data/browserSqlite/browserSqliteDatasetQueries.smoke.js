import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
} from './browserSqliteDatabase.js';
import {
  BrowserSqliteQueryError,
  MAX_BROWSER_SQLITE_PREVIEW_LIMIT,
  getBrowserSqliteDatasetSummary,
  getBrowserSqlitePreviewPage,
} from './browserSqliteDatasetQueries.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  insertFixtures(database);

  const summary = getBrowserSqliteDatasetSummary(database);
  assert.equal(summary.datasets.length, 2);
  assert.equal(summary.selectedDatasetId, null);
  assert.equal(summary.timeline, null);
  assert.deepEqual(summary.datasets.map((dataset) => dataset.id), [
    'dataset-newer',
    'dataset-older',
  ]);
  assert.deepEqual(summary.datasets[0], {
    id: 'dataset-newer',
    name: 'newer.csv',
    enabled: true,
    headers: ['name', 'lat', 'lon'],
    rowCount: 3,
    totalRows: 4,
    sizeBytes: 120,
    importedFeatureCount: 0,
    skippedRowCount: 1,
    importedAt: '2026-07-26T12:00:00.000Z',
    latField: 'lat',
    lonField: 'lon',
    detectedFields: {
      latField: 'lat',
      lonField: 'lon',
      yearField: null,
    },
    parseErrors: ['One malformed row was skipped.'],
  });
  assert.deepEqual(summary.datasets[1].headers, []);
  assert.deepEqual(summary.datasets[1].detectedFields, {});
  assert.deepEqual(summary.datasets[1].parseErrors, []);
  assert.equal(summary.datasets[1].latField, null);
  assert.equal(summary.datasets[1].lonField, null);
  assert.equal(Object.hasOwn(summary.datasets[0], 'rows'), false);
  assert.equal(JSON.stringify(summary).includes('row-only sentinel'), false);

  assert.deepEqual(getBrowserSqlitePreviewPage(database, {
    datasetId: 'dataset-newer',
    offset: 0,
    limit: 2,
  }), {
    datasetId: 'dataset-newer',
    rows: [
      { name: 'First', lat: '59.3', lon: '18.1' },
      { name: 'No coordinates', note: 'row-only sentinel' },
    ],
    offset: 0,
    limit: 2,
    totalRows: 3,
    hasMore: true,
  });

  assert.deepEqual(getBrowserSqlitePreviewPage(database, {
    datasetId: 'dataset-newer',
    offset: 2,
    limit: 1,
  }), {
    datasetId: 'dataset-newer',
    rows: [{}],
    offset: 2,
    limit: 1,
    totalRows: 3,
    hasMore: false,
  });

  const boundedPage = getBrowserSqlitePreviewPage(database, {
    datasetId: 'dataset-newer',
    limit: 10_000,
  });
  assert.equal(boundedPage.limit, MAX_BROWSER_SQLITE_PREVIEW_LIMIT);
  assert.equal(boundedPage.rows.length, 3);

  assert.deepEqual(getBrowserSqlitePreviewPage(database, {
    datasetId: 'dataset-newer',
    offset: 3,
  }), {
    datasetId: 'dataset-newer',
    rows: [],
    offset: 3,
    limit: 30,
    totalRows: 3,
    hasMore: false,
  });

  assertQueryError(
    () => getBrowserSqlitePreviewPage(database),
    'invalid-preview-query',
  );
  assertQueryError(
    () => getBrowserSqlitePreviewPage(database, {
      datasetId: 'dataset-newer',
      offset: -1,
    }),
    'invalid-preview-query',
  );
  assertQueryError(
    () => getBrowserSqlitePreviewPage(database, {
      datasetId: 'dataset-newer',
      offset: 1.5,
    }),
    'invalid-preview-query',
  );
  assertQueryError(
    () => getBrowserSqlitePreviewPage(database, {
      datasetId: 'dataset-newer',
      limit: 0,
    }),
    'invalid-preview-query',
  );
  assertQueryError(
    () => getBrowserSqlitePreviewPage(database, {
      datasetId: 'missing',
    }),
    'dataset-not-found',
  );
} finally {
  closeBrowserSqliteDatabase(database);
}

console.log('Browser SQLite dataset summary and preview smoke test passed.');

function insertFixtures(targetDatabase) {
  insertDataset(targetDatabase, {
    id: 'dataset-newer',
    fileName: 'newer.csv',
    sizeBytes: 120,
    columnsJson: JSON.stringify(['name', 'lat', 'lon']),
    totalRows: 4,
    storedRows: 3,
    skippedRows: 1,
    enabled: 1,
    detectedFieldsJson: JSON.stringify({
      latField: 'lat',
      lonField: 'lon',
      yearField: null,
    }),
    mappingJson: JSON.stringify({ latField: 'lat', lonField: 'lon' }),
    warningsJson: JSON.stringify(['One malformed row was skipped.']),
    importState: 'complete',
    importedAt: '2026-07-26T12:00:00.000Z',
  });
  insertDataset(targetDatabase, {
    id: 'dataset-older',
    fileName: 'older.csv',
    sizeBytes: null,
    columnsJson: JSON.stringify('unexpected columns shape'),
    totalRows: 1,
    storedRows: 1,
    skippedRows: 0,
    enabled: 0,
    detectedFieldsJson: 'null',
    mappingJson: '[]',
    warningsJson: JSON.stringify('unexpected warning shape'),
    importState: 'complete',
    importedAt: '2026-07-25T12:00:00.000Z',
  });
  insertDataset(targetDatabase, {
    id: 'dataset-importing',
    fileName: 'importing.csv',
    sizeBytes: 0,
    columnsJson: '[]',
    totalRows: 0,
    storedRows: 0,
    skippedRows: 0,
    enabled: 1,
    detectedFieldsJson: '{}',
    mappingJson: '{}',
    warningsJson: '[]',
    importState: 'importing',
    importedAt: null,
  });

  const insertSourceRow = targetDatabase.prepare(`
    INSERT INTO source_rows (dataset_id, source_row_index, row_json)
    VALUES (?, ?, ?)
  `);

  try {
    insertSourceRow.run([
      'dataset-newer',
      0,
      JSON.stringify({ name: 'First', lat: '59.3', lon: '18.1' }),
    ]);
    insertSourceRow.run([
      'dataset-newer',
      1,
      JSON.stringify({ name: 'No coordinates', note: 'row-only sentinel' }),
    ]);
    insertSourceRow.run([
      'dataset-newer',
      2,
      JSON.stringify('unexpected row shape'),
    ]);
    insertSourceRow.run([
      'dataset-older',
      0,
      JSON.stringify({ name: 'Older row' }),
    ]);
  } finally {
    insertSourceRow.free();
  }

  // Simulate corrupt stored JSON to verify that preview parsing stays safe.
  targetDatabase.run('PRAGMA ignore_check_constraints = ON');
  targetDatabase.run(`
    UPDATE source_rows
    SET row_json = '{'
    WHERE dataset_id = 'dataset-newer' AND source_row_index = 2
  `);
  targetDatabase.run('PRAGMA ignore_check_constraints = OFF');
}

function insertDataset(targetDatabase, fixture) {
  targetDatabase.run(`
    INSERT INTO datasets (
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
      import_state,
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    fixture.id,
    fixture.fileName,
    fixture.sizeBytes,
    fixture.columnsJson,
    fixture.totalRows,
    fixture.storedRows,
    fixture.skippedRows,
    fixture.enabled,
    fixture.detectedFieldsJson,
    fixture.mappingJson,
    fixture.warningsJson,
    fixture.importState,
    fixture.importedAt,
  ]);
}

function assertQueryError(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof BrowserSqliteQueryError &&
    error.code === code &&
    !String(error.message).includes('SELECT')
  ));
}
