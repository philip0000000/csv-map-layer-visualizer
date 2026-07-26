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
  BrowserSqliteImportBatchError,
  MAX_BROWSER_SQLITE_IMPORT_FILES,
  importBrowserSqliteCsvBatch,
} from './browserSqliteImportBatch.js';

class TestBrowserFile {
  constructor(content, name) {
    this.blob = new Blob([content], { type: 'text/csv' });
    this.name = name;
    this.type = 'text/csv';
    this.lastModified = 1_750_000_000_000;
    this.size = this.blob.size;
    this.sliceCount = 0;
  }

  slice(start, end) {
    this.sliceCount += 1;
    return this.blob.slice(start, end);
  }

  text() {
    throw new Error('The batch importer must not call File.text().');
  }
}

const restoreFileReader = installFileReaderShim();
const restorePersistenceGuards = installPersistenceGuards();
const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  const successProgress = [];
  const successFiles = [
    new TestBrowserFile(
      'name,lat,lon\nFirst,59.3,18.1\nSecond,57.7,11.9',
      String.raw`C:\private\first.csv`,
    ),
    new TestBrowserFile(
      'name;latitude;longitude\nThird;55.6;13.0',
      'second.csv',
    ),
  ];
  const success = await importBrowserSqliteCsvBatch(
    database,
    successFiles,
    batchOptions('batch-success', {
      onProgress: (progress) => successProgress.push(progress),
      progressIntervalMs: 0,
      chunkSizeBytes: 18,
      batchSize: 1,
    }),
  );

  assert.equal(success.ok, true);
  assert.equal(success.canceled, false);
  assert.equal(success.successfulCount, 2);
  assert.equal(success.failedCount, 0);
  assert.equal(success.error, null);
  assert.deepEqual(success.results.map((result) => result.datasetId), [
    'batch-success-dataset-1',
    'batch-success-dataset-2',
  ]);
  assert.deepEqual(success.results.map((result) => result.fileName), [
    'first.csv',
    'second.csv',
  ]);
  assert.ok(success.results.every((result) => (
    result.ok && !Object.hasOwn(result, 'rows')
  )));
  assert.deepEqual(
    successProgress.filter((progress) => progress.state === 'queued')
      .map((progress) => progress.fileNumber),
    [1, 2],
  );
  assert.deepEqual(
    successProgress.filter((progress) => progress.state === 'completed')
      .map((progress) => [progress.fileNumber, progress.ok]),
    [[1, true], [2, true]],
  );
  assert.ok(successProgress.some((progress) => progress.state === 'parsing'));
  assert.ok(successProgress.some((progress) => progress.state === 'storing'));

  const mixedFiles = [
    new TestBrowserFile('name,lat,lon\nKept,1,2', 'kept.csv'),
    new TestBrowserFile('', 'empty.csv'),
    new TestBrowserFile('name,lat,lon\nLater,3,4', 'later.csv'),
  ];
  const mixed = await importBrowserSqliteCsvBatch(
    database,
    mixedFiles,
    batchOptions('batch-mixed', {
      chunkSizeBytes: 12,
      batchSize: 1,
    }),
  );

  assert.equal(mixed.ok, true);
  assert.equal(mixed.canceled, false);
  assert.equal(mixed.successfulCount, 2);
  assert.equal(mixed.failedCount, 1);
  assert.deepEqual(mixed.results.map((result) => result.ok), [true, false, true]);
  assert.deepEqual(mixed.results[1].error, {
    code: 'import-failed',
    message: 'The CSV file could not be imported.',
  });
  assert.equal(countDatasets(database, 'batch-mixed-dataset-1'), 1);
  assert.equal(countDatasets(database, 'batch-mixed-dataset-2'), 0);
  assert.equal(countDatasets(database, 'batch-mixed-dataset-3'), 1);

  let progressClock = 0;
  const throttledProgress = [];
  const throttledFile = new TestBrowserFile(
    createCsvRows(40),
    'throttled.csv',
  );
  const throttled = await importBrowserSqliteCsvBatch(
    database,
    [throttledFile],
    batchOptions('batch-throttled', {
      onProgress: (progress) => throttledProgress.push(progress),
      progressIntervalMs: 50,
      progressNow: () => {
        progressClock += 10;
        return progressClock;
      },
      chunkSizeBytes: 24,
      batchSize: 1,
    }),
  );
  assert.equal(throttled.ok, true);
  const incrementalProgress = throttledProgress.filter((progress) => (
    progress.state === 'parsing' || progress.state === 'storing'
  ));
  assert.ok(incrementalProgress.length > 0);
  assert.ok(incrementalProgress.length < 40);
  assert.deepEqual(throttledProgress.at(-1), {
    importId: 'batch-throttled',
    state: 'completed',
    fileName: 'throttled.csv',
    fileNumber: 1,
    totalFiles: 1,
    completedRows: 40,
    totalRows: 40,
    ok: true,
  });

  let cancelRequested = false;
  const cancellationProgress = [];
  const cancellationFiles = [
    new TestBrowserFile('name,lat,lon\nCommitted,1,2', 'committed.csv'),
    new TestBrowserFile(createCsvRows(60), 'active.csv'),
    new TestBrowserFile('name,lat,lon\nUnopened,5,6', 'unopened.csv'),
  ];
  const canceled = await importBrowserSqliteCsvBatch(
    database,
    cancellationFiles,
    batchOptions('batch-canceled', {
      shouldCancel: () => cancelRequested,
      onProgress: (progress) => {
        cancellationProgress.push(progress);
        if (
          progress.fileNumber === 2 &&
          progress.state === 'storing' &&
          progress.completedRows >= 2
        ) {
          cancelRequested = true;
        }
      },
      progressIntervalMs: 0,
      chunkSizeBytes: 40,
      batchSize: 2,
    }),
  );

  assert.equal(canceled.ok, false);
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.successfulCount, 1);
  assert.equal(canceled.failedCount, 1);
  assert.equal(canceled.results.length, 2);
  assert.deepEqual(canceled.results.map((result) => result.ok), [true, false]);
  assert.deepEqual(canceled.results[1].error, {
    code: 'import-canceled',
    message: 'Import canceled.',
  });
  assert.deepEqual(canceled.error, {
    code: 'import-canceled',
    message: 'Import canceled.',
  });
  assert.equal(countDatasets(database, 'batch-canceled-dataset-1'), 1);
  assert.equal(countSourceRows(database, 'batch-canceled-dataset-1'), 1);
  assert.equal(countDatasets(database, 'batch-canceled-dataset-2'), 0);
  assert.equal(countSourceRows(database, 'batch-canceled-dataset-2'), 0);
  assert.equal(countDatasets(database, 'batch-canceled-dataset-3'), 0);
  assert.equal(cancellationFiles[2].sliceCount, 0);
  assert.deepEqual(
    cancellationProgress.filter((progress) => progress.state === 'completed')
      .map((progress) => [progress.fileNumber, progress.ok]),
    [[1, true], [2, false]],
  );

  const reused = await importBrowserSqliteCsvBatch(
    database,
    [new TestBrowserFile('name,lat,lon\nReusable,7,8', 'reused.csv')],
    batchOptions('batch-reused', {
      chunkSizeBytes: 16,
      batchSize: 1,
    }),
  );
  assert.equal(reused.ok, true);
  assert.equal(reused.successfulCount, 1);
  assert.equal(countDatasets(database, 'batch-reused-dataset-1'), 1);
  assert.equal(countDatasets(database, 'batch-canceled-dataset-1'), 1);
  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);

  await assert.rejects(
    importBrowserSqliteCsvBatch(database, []),
    (error) => error instanceof BrowserSqliteImportBatchError &&
      error.code === 'invalid-file-batch',
  );
  await assert.rejects(
    importBrowserSqliteCsvBatch(
      database,
      Array.from(
        { length: MAX_BROWSER_SQLITE_IMPORT_FILES + 1 },
        (_, index) => new TestBrowserFile('name\nrow', `file-${index}.csv`),
      ),
    ),
    (error) => error instanceof BrowserSqliteImportBatchError &&
      error.code === 'invalid-file-batch',
  );

  const summary = getBrowserSqliteDatasetSummary(database);
  assert.equal(summary.datasets.length, 7);
  assert.ok(summary.datasets.every((dataset) => !Object.hasOwn(dataset, 'rows')));
} finally {
  closeBrowserSqliteDatabase(database);
  restorePersistenceGuards();
  restoreFileReader();
}

console.log('Browser SQLite import batch and cancellation smoke test passed.');

function batchOptions(importId, overrides = {}) {
  return {
    importId,
    createDatasetId: (_file, fileNumber) => (
      `${importId}-dataset-${fileNumber}`
    ),
    now: () => '2026-07-26T16:00:00.000Z',
    ...overrides,
  };
}

function createCsvRows(count) {
  const lines = ['name,lat,lon'];
  for (let index = 0; index < count; index += 1) {
    lines.push(`Row ${index},${index % 80},${index % 170}`);
  }
  return lines.join('\n');
}

function installFileReaderShim() {
  const originalFileReader = globalThis.FileReader;
  globalThis.FileReader = class FileReaderShim {
    readAsText(blob) {
      Promise.resolve().then(async () => {
        try {
          const result = await blob.text();
          this.onload?.({ target: { result } });
        } catch (error) {
          this.error = error;
          this.onerror?.();
        }
      });
    }
  };

  return () => {
    if (originalFileReader === undefined) {
      delete globalThis.FileReader;
    } else {
      globalThis.FileReader = originalFileReader;
    }
  };
}

function installPersistenceGuards() {
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
        throw new Error(`${propertyName} must not be used by import batches.`);
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
