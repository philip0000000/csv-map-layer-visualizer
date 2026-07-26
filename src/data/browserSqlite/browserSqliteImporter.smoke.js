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
  BrowserSqliteImporterError,
  importBrowserSqliteCsvFile,
} from './browserSqliteImporter.js';

class TestBrowserFile {
  constructor(content, options = {}) {
    this.blob = new Blob([content], { type: options.type ?? 'text/csv' });
    this.name = options.name ?? 'fixture.csv';
    this.type = options.type ?? 'text/csv';
    this.lastModified = options.lastModified ?? 1_750_000_000_000;
    this.size = this.blob.size;
    this.failAtSliceStart = options.failAtSliceStart ?? null;
    this.maximumSliceSize = 0;
    this.sliceCount = 0;
    this.textCallCount = 0;
  }

  slice(start, end) {
    this.sliceCount += 1;
    this.maximumSliceSize = Math.max(this.maximumSliceSize, end - start);
    if (this.failAtSliceStart != null && start >= this.failAtSliceStart) {
      return { simulatedReadFailure: true };
    }
    return this.blob.slice(start, end);
  }

  text() {
    this.textCallCount += 1;
    throw new Error('The importer must not call File.text().');
  }
}

const restoreFileReader = installFileReaderShim();
const restorePersistenceGuards = installPersistenceGuards();
const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  const csv = [
    'name;latitude;longitude;latitude;year;dayOfYear;yearFrom;yearTo;dateFrom;dateTo',
    '"Alpha; Inc";59.3;18.1;shadow;2020;100;2019;2021;2019-01-01;2021-01-01',
    '"Second ""quoted""";;;;2022',
    'Third;57.7;11.9;shadow;2023;200;2022;2024;2022-01-01;2024-01-01;ignored',
  ].join('\n');
  const primaryFile = new TestBrowserFile(csv, {
    name: String.raw`C:\private\incremental.csv`,
    type: 'text/csv',
    lastModified: 1_750_000_000_000,
  });
  const result = await importBrowserSqliteCsvFile(database, primaryFile, {
    datasetId: 'dataset-incremental',
    chunkSizeBytes: 29,
    batchSize: 2,
    now: () => '2026-07-26T15:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.fileName, 'incremental.csv');
  assert.equal(result.datasetId, 'dataset-incremental');
  assert.equal(result.rowCount, 3);
  assert.equal(result.totalParsedRowCount, 3);
  assert.equal(result.skippedRowCount, 0);
  assert.equal(result.storedBatchCount, 2);
  assert.equal(result.importedFeatureCount, 0);
  assert.deepEqual(result.detectedFields, {
    latField: 'latitude',
    lonField: 'longitude',
    yearField: 'year',
    dateField: 'dateFrom',
    dayOfYearField: 'dayOfYear',
    yearFromField: 'yearFrom',
    yearToField: 'yearTo',
    dateFromField: 'dateFrom',
    dateToField: 'dateTo',
  });
  assert.ok(result.warnings.some((warning) => (
    warning.includes('had 11 values; truncated to 10')
  )));
  assert.equal(primaryFile.textCallCount, 0);
  assert.ok(primaryFile.sliceCount > 1);
  assert.ok(primaryFile.maximumSliceSize <= 29);

  const summary = getBrowserSqliteDatasetSummary(database).datasets
    .find((dataset) => dataset.id === 'dataset-incremental');
  assert.deepEqual(summary.headers, [
    'name',
    'latitude',
    'longitude',
    'latitude_2',
    'year',
    'dayOfYear',
    'yearFrom',
    'yearTo',
    'dateFrom',
    'dateTo',
  ]);
  assert.equal(summary.rowCount, 3);
  assert.equal(summary.totalRows, 3);
  assert.equal(summary.latField, 'latitude');
  assert.equal(summary.lonField, 'longitude');

  const preview = getBrowserSqlitePreviewPage(database, {
    datasetId: 'dataset-incremental',
    limit: 10,
  });
  assert.deepEqual(preview.rows, [
    {
      name: 'Alpha; Inc',
      latitude: '59.3',
      longitude: '18.1',
      latitude_2: 'shadow',
      year: '2020',
      dayOfYear: '100',
      yearFrom: '2019',
      yearTo: '2021',
      dateFrom: '2019-01-01',
      dateTo: '2021-01-01',
    },
    {
      name: 'Second "quoted"',
      latitude: '',
      longitude: '',
      latitude_2: '',
      year: '2022',
      dayOfYear: '',
      yearFrom: '',
      yearTo: '',
      dateFrom: '',
      dateTo: '',
    },
    {
      name: 'Third',
      latitude: '57.7',
      longitude: '11.9',
      latitude_2: 'shadow',
      year: '2023',
      dayOfYear: '200',
      yearFrom: '2022',
      yearTo: '2024',
      dateFrom: '2022-01-01',
      dateTo: '2024-01-01',
    },
  ]);

  const malformedFile = new TestBrowserFile(
    'name,lat,lon\n"Unclosed,59,18',
    { name: 'malformed.csv' },
  );
  const malformedResult = await importBrowserSqliteCsvFile(
    database,
    malformedFile,
    {
      datasetId: 'dataset-malformed',
      chunkSizeBytes: 12,
      batchSize: 1,
      now: () => '2026-07-26T15:01:00.000Z',
    },
  );
  assert.equal(malformedResult.rowCount, 1);
  assert.ok(malformedResult.warnings.some((warning) => (
    warning.startsWith('Parser:')
  )));

  const headerOnlyResult = await importBrowserSqliteCsvFile(
    database,
    new TestBrowserFile('name,lat,lon\n', { name: 'header-only.csv' }),
    {
      datasetId: 'dataset-header-only',
      chunkSizeBytes: 8,
      batchSize: 2,
      now: () => '2026-07-26T15:02:00.000Z',
    },
  );
  assert.equal(headerOnlyResult.rowCount, 0);
  assert.equal(headerOnlyResult.storedBatchCount, 0);
  assert.ok(headerOnlyResult.warnings.includes(
    'No usable data rows were parsed.',
  ));

  const readFailureFile = new TestBrowserFile(
    'name,lat,lon\nFirst,1,2\nSecond,3,4\nThird,5,6',
    { name: 'read-failure.csv', failAtSliceStart: 18 },
  );
  await assertImporterRejects(
    importBrowserSqliteCsvFile(database, readFailureFile, {
      datasetId: 'dataset-read-failure',
      chunkSizeBytes: 18,
      batchSize: 1,
      now: () => '2026-07-26T15:03:00.000Z',
    }),
    'csv-read-failed',
  );
  assert.equal(countDatasets(database, 'dataset-read-failure'), 0);
  assert.equal(countDatasets(database, 'dataset-incremental'), 1);

  database.run(`
    CREATE TRIGGER fail_importer_storage
    BEFORE INSERT ON source_rows
    WHEN NEW.dataset_id = 'dataset-storage-failure'
      AND json_extract(NEW.row_json, '$.name') = 'fail'
    BEGIN
      SELECT RAISE(ABORT, 'simulated importer storage failure');
    END
  `);
  await assertImporterRejects(
    importBrowserSqliteCsvFile(
      database,
      new TestBrowserFile(
        'name,lat,lon\nkept-until-rollback,1,2\nfail,3,4',
        { name: 'storage-failure.csv' },
      ),
      {
        datasetId: 'dataset-storage-failure',
        chunkSizeBytes: 16,
        batchSize: 1,
        now: () => '2026-07-26T15:04:00.000Z',
      },
    ),
    'csv-import-storage-failed',
  );
  assert.equal(countDatasets(database, 'dataset-storage-failure'), 0);
  assert.equal(countSourceRows(database, 'dataset-storage-failure'), 0);
  assert.equal(countDatasets(database, 'dataset-incremental'), 1);
  assert.equal(countSourceRows(database, 'dataset-incremental'), 3);
  database.run('DROP TRIGGER fail_importer_storage');

  await assertImporterRejects(
    importBrowserSqliteCsvFile(
      database,
      new TestBrowserFile('', { name: 'empty.csv' }),
      {
        datasetId: 'dataset-empty',
        chunkSizeBytes: 8,
        now: () => '2026-07-26T15:05:00.000Z',
      },
    ),
    'csv-empty',
  );
  assert.equal(countDatasets(database, 'dataset-empty'), 0);
  assert.equal(countDatasets(database, 'dataset-incremental'), 1);
  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);
} finally {
  closeBrowserSqliteDatabase(database);
  restorePersistenceGuards();
  restoreFileReader();
}

console.log('Browser SQLite incremental CSV importer smoke test passed.');

function installFileReaderShim() {
  const originalFileReader = globalThis.FileReader;

  globalThis.FileReader = class FileReaderShim {
    readAsText(blob) {
      Promise.resolve().then(async () => {
        if (blob?.simulatedReadFailure) {
          this.error = new Error('simulated private read failure');
          this.onerror?.();
          return;
        }
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

async function assertImporterRejects(promise, code) {
  await assert.rejects(promise, (error) => (
    error instanceof BrowserSqliteImporterError &&
    error.code === code &&
    !String(error.message).includes('INSERT') &&
    !String(error.message).includes('simulated') &&
    !String(error.message).includes('private')
  ));
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
