import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
} from './browserSqliteDatabase.js';
import {
  getBrowserSqliteDatasetSummary,
  getBrowserSqlitePreviewPage,
} from './browserSqliteDatasetQueries.js';
import {
  BrowserSqliteImportTransactionError,
  MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS,
  beginBrowserSqliteFileImport,
  completeBrowserSqliteFileImport,
  insertBrowserSqliteImportRowBatch,
  rollbackBrowserSqliteFileImport,
} from './browserSqliteImportTransaction.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);
let persistenceAccessCount = 0;
let freedInsertStatementCount = 0;
const restorePersistenceGuards = installPersistenceGuards(() => {
  persistenceAccessCount += 1;
});
const restoreStatementTracking = trackInsertStatementCleanup(database, () => {
  freedInsertStatementCount += 1;
});

try {
  const firstImport = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-first',
    fileName: String.raw`C:\private\first.csv`,
    sizeBytes: 321,
    mimeType: 'text/csv',
    lastModifiedMs: 1_750_000_000_000,
  });
  assert.deepEqual(
    insertBrowserSqliteImportRowBatch(firstImport, [
      { name: 'First', lat: '59.3', lon: '18.1', year: '2020' },
      { name: 'No coordinates', lat: '', lon: '', year: '2021' },
    ]),
    {
      datasetId: 'dataset-first',
      insertedRowCount: 2,
      storedRowCount: 2,
    },
  );
  assert.deepEqual(
    insertBrowserSqliteImportRowBatch(firstImport, [
      { name: 'Third', lat: '57.7', lon: '11.9', year: '2022' },
    ]),
    {
      datasetId: 'dataset-first',
      insertedRowCount: 1,
      storedRowCount: 3,
    },
  );

  const completed = completeBrowserSqliteFileImport(firstImport, {
    headers: ['name', 'lat', 'lon', 'year'],
    totalParsedRowCount: 4,
    skippedRowCount: 1,
    detectedFields: detectedFields({
      latField: 'lat',
      lonField: 'lon',
      yearField: 'year',
    }),
    coordinateMapping: { latField: 'lat', lonField: 'lon' },
    warnings: ['Line 5 was skipped.'],
    importedAt: '2026-07-26T14:00:00.000Z',
  });
  assert.deepEqual(completed, {
    datasetId: 'dataset-first',
    rowCount: 3,
    totalParsedRowCount: 4,
    skippedRowCount: 1,
    pointFeatureCount: 2,
    skippedPointCount: 1,
    importedAt: '2026-07-26T14:00:00.000Z',
  });
  assert.equal(freedInsertStatementCount, 1);
  assert.deepEqual(readSourceIndexes(database, 'dataset-first'), [0, 1, 2]);
  assert.deepEqual(
    getBrowserSqlitePreviewPage(database, {
      datasetId: 'dataset-first',
      limit: 10,
    }).rows,
    [
      { name: 'First', lat: '59.3', lon: '18.1', year: '2020' },
      { name: 'No coordinates', lat: '', lon: '', year: '2021' },
      { name: 'Third', lat: '57.7', lon: '11.9', year: '2022' },
    ],
  );

  const firstSummary = getBrowserSqliteDatasetSummary(database).datasets[0];
  assert.equal(firstSummary.name, 'first.csv');
  assert.equal(firstSummary.rowCount, 3);
  assert.equal(firstSummary.totalRows, 4);
  assert.equal(firstSummary.skippedRowCount, 1);
  assert.deepEqual(firstSummary.detectedFields, detectedFields({
    latField: 'lat',
    lonField: 'lon',
    yearField: 'year',
  }));

  const rolledBackImport = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-rolled-back',
    fileName: 'rolled-back.csv',
  });
  insertBrowserSqliteImportRowBatch(rolledBackImport, [{ name: 'temporary' }]);
  assert.deepEqual(rollbackBrowserSqliteFileImport(rolledBackImport), {
    datasetId: 'dataset-rolled-back',
    rolledBack: true,
  });
  assert.deepEqual(rollbackBrowserSqliteFileImport(rolledBackImport), {
    datasetId: 'dataset-rolled-back',
    rolledBack: false,
  });
  assert.equal(countDatasets(database, 'dataset-rolled-back'), 0);
  assert.equal(countDatasets(database, 'dataset-first'), 1);

  assertImportError(
    () => beginBrowserSqliteFileImport(database, {
      datasetId: '',
      fileName: 'invalid.csv',
    }),
    'invalid-import-metadata',
  );
  assert.equal(countDatasets(database, 'dataset-first'), 1);

  const invalidBatchImport = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-invalid-batch',
    fileName: 'invalid-batch.csv',
  });
  assertImportError(
    () => insertBrowserSqliteImportRowBatch(invalidBatchImport, [
      { name: 'normalized' },
      { name: 42 },
    ]),
    'invalid-row-batch',
  );
  assert.equal(countDatasets(database, 'dataset-invalid-batch'), 0);

  const tooLargeBatchImport = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-large-batch',
    fileName: 'large-batch.csv',
  });
  assertImportError(
    () => insertBrowserSqliteImportRowBatch(
      tooLargeBatchImport,
      Array.from(
        { length: MAX_BROWSER_SQLITE_IMPORT_BATCH_ROWS + 1 },
        () => ({ name: 'bounded' }),
      ),
    ),
    'invalid-row-batch',
  );
  assert.equal(countDatasets(database, 'dataset-large-batch'), 0);

  database.run(`
    CREATE TRIGGER fail_selected_import_row
    BEFORE INSERT ON source_rows
    WHEN NEW.dataset_id = 'dataset-insert-failure'
      AND json_extract(NEW.row_json, '$.name') = 'fail'
    BEGIN
      SELECT RAISE(ABORT, 'simulated insertion failure');
    END
  `);
  const failedInsert = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-insert-failure',
    fileName: 'failure.csv',
  });
  assertImportError(
    () => insertBrowserSqliteImportRowBatch(failedInsert, [
      { name: 'inserted before failure' },
      { name: 'fail' },
    ]),
    'import-storage-failed',
  );
  assert.equal(countDatasets(database, 'dataset-insert-failure'), 0);
  assert.equal(countSourceRows(database, 'dataset-insert-failure'), 0);
  assert.equal(countDatasets(database, 'dataset-first'), 1);
  assert.equal(countSourceRows(database, 'dataset-first'), 3);
  database.run('DROP TRIGGER fail_selected_import_row');

  const invalidFinalization = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-invalid-finalization',
    fileName: 'invalid-finalization.csv',
  });
  insertBrowserSqliteImportRowBatch(
    invalidFinalization,
    [{ name: 'temporary' }],
  );
  assertImportError(
    () => completeBrowserSqliteFileImport(invalidFinalization, {
      headers: ['name'],
      totalParsedRowCount: 3,
      skippedRowCount: 0,
      detectedFields: detectedFields(),
      coordinateMapping: { latField: null, lonField: null },
      warnings: [],
      importedAt: '2026-07-26T14:05:00.000Z',
    }),
    'invalid-import-finalization',
  );
  assert.equal(countDatasets(database, 'dataset-invalid-finalization'), 0);

  const reuseImport = beginBrowserSqliteFileImport(database, {
    datasetId: 'dataset-reuse',
    fileName: 'reuse.csv',
  });
  insertBrowserSqliteImportRowBatch(reuseImport, [{ name: 'still usable' }]);
  completeBrowserSqliteFileImport(reuseImport, {
    headers: ['name'],
    totalParsedRowCount: 1,
    skippedRowCount: 0,
    detectedFields: detectedFields(),
    coordinateMapping: { latField: null, lonField: null },
    warnings: [],
    importedAt: '2026-07-26T14:10:00.000Z',
  });

  assert.equal(countDatasets(database, 'dataset-first'), 1);
  assert.equal(countDatasets(database, 'dataset-reuse'), 1);
  assert.equal(countSourceRows(database, 'dataset-reuse'), 1);
  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);
  assert.equal(freedInsertStatementCount, 7);
  assert.equal(persistenceAccessCount, 0);
} finally {
  restoreStatementTracking();
  restorePersistenceGuards();
  closeBrowserSqliteDatabase(database);
}

console.log('Browser SQLite file import transaction smoke test passed.');

function detectedFields(overrides = {}) {
  return {
    latField: null,
    lonField: null,
    yearField: null,
    dateField: null,
    dayOfYearField: null,
    yearFromField: null,
    yearToField: null,
    dateFromField: null,
    dateToField: null,
    ...overrides,
  };
}

function readSourceIndexes(targetDatabase, datasetId) {
  const statement = targetDatabase.prepare(`
    SELECT source_row_index
    FROM source_rows
    WHERE dataset_id = ?
    ORDER BY source_row_index
  `);
  const indexes = [];
  try {
    statement.bind([datasetId]);
    while (statement.step()) indexes.push(statement.get()[0]);
  } finally {
    statement.free();
  }
  return indexes;
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

function assertImportError(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof BrowserSqliteImportTransactionError &&
    error.code === code &&
    !String(error.message).includes('INSERT') &&
    !String(error.message).includes('UPDATE') &&
    !String(error.message).includes('simulated')
  ));
}

function trackInsertStatementCleanup(targetDatabase, onFree) {
  const originalPrepare = targetDatabase.prepare.bind(targetDatabase);
  targetDatabase.prepare = (sql, parameters) => {
    const statement = originalPrepare(sql, parameters);
    if (
      typeof sql === 'string' &&
      sql.includes('INSERT INTO source_rows')
    ) {
      const originalFree = statement.free.bind(statement);
      let freed = false;
      statement.free = () => {
        if (!freed) {
          freed = true;
          onFree();
        }
        return originalFree();
      };
    }
    return statement;
  };
  return () => {
    targetDatabase.prepare = originalPrepare;
  };
}

function installPersistenceGuards(onAccess) {
  const propertyNames = ['indexedDB', 'localStorage', 'sessionStorage'];
  const originalDescriptors = new Map();

  for (const propertyName of propertyNames) {
    originalDescriptors.set(
      propertyName,
      Object.getOwnPropertyDescriptor(globalThis, propertyName),
    );
    Object.defineProperty(globalThis, propertyName, {
      configurable: true,
      get() {
        onAccess();
        throw new Error(`${propertyName} must not be used by imports.`);
      },
    });
  }

  return () => {
    for (const [propertyName, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, propertyName, descriptor);
      } else {
        delete globalThis[propertyName];
      }
    }
  };
}
