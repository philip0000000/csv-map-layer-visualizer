import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  BROWSER_SQLITE_OPERATIONS,
} from './browserSqliteProtocol.js';
import {
  createBrowserSqliteWorkerRuntime,
} from './browserSqliteWorkerRuntime.js';

class TestBrowserFile {
  constructor(content, name) {
    this.blob = new Blob([content], { type: 'text/csv' });
    this.name = name;
    this.type = 'text/csv';
    this.lastModified = 1_750_000_000_000;
    this.size = this.blob.size;
  }

  slice(start, end) {
    return this.blob.slice(start, end);
  }
}

const restoreFileReader = installFileReaderShim();
const messages = [];
const cancellationPromises = [];
let cancellationSent = false;
let runtime;

try {
  runtime = createBrowserSqliteWorkerRuntime({
    initializeSql: initSqlJs,
    postMessage: (message) => {
      messages.push(message);
      if (
        !cancellationSent &&
        message.type === 'progress' &&
        message.importId === 'import-cancel' &&
        message.state === 'storing'
      ) {
        cancellationSent = true;
        cancellationPromises.push(
          runtime.handleMessage(request(
            'cancel-unrelated',
            BROWSER_SQLITE_OPERATIONS.CANCEL_IMPORT,
            { importId: 'another-import' },
          )),
          runtime.handleMessage(request(
            'cancel-active',
            BROWSER_SQLITE_OPERATIONS.CANCEL_IMPORT,
            { importId: 'import-cancel' },
          )),
        );
      }
    },
  });

  const firstInitialize = await runtime.handleMessage(request(
    'initialize-first',
    BROWSER_SQLITE_OPERATIONS.INITIALIZE,
  ));
  assert.deepEqual(firstInitialize.result, {
    initialized: true,
    reused: false,
    databaseStorage: 'memory',
    schemaVersion: 3,
  });
  const repeatedInitialize = await runtime.handleMessage(request(
    'initialize-repeated',
    BROWSER_SQLITE_OPERATIONS.INITIALIZE,
  ));
  assert.equal(repeatedInitialize.result.reused, true);

  const unsupported = await runtime.handleMessage({
    requestId: 'unsupported',
    operation: 'execute-sql',
    payload: { sql: 'DROP TABLE datasets' },
  });
  assertFailure(unsupported, 'unsupported-operation');
  const uncorrelated = await runtime.handleMessage({
    operation: BROWSER_SQLITE_OPERATIONS.INITIALIZE,
  });
  assertFailure(uncorrelated, 'invalid-request');
  assert.equal(uncorrelated.requestId, null);

  const imported = await runtime.handleMessage(request(
    'import-first',
    BROWSER_SQLITE_OPERATIONS.IMPORT_FILES,
    {
      importId: 'import-first',
      files: [new TestBrowserFile(
        'name,lat,lon\nFirst,59.3,18.1\nSecond,57.7,11.9',
        'first.csv',
      )],
    },
  ));
  assert.equal(imported.ok, true);
  assert.equal(imported.result.successfulCount, 1);
  const firstDatasetId = imported.result.results[0].datasetId;
  assert.ok(firstDatasetId);
  assert.ok(messages.some((message) => (
    message.type === 'progress' &&
    message.importId === 'import-first' &&
    !Object.hasOwn(message, 'rows')
  )));

  const summary = await runtime.handleMessage(request(
    'summary-first',
    BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY,
  ));
  assert.equal(summary.result.datasets.length, 1);
  assert.equal(summary.result.datasets[0].id, firstDatasetId);
  const preview = await runtime.handleMessage(request(
    'preview-first',
    BROWSER_SQLITE_OPERATIONS.GET_PREVIEW_PAGE,
    { datasetId: firstDatasetId, offset: 0, limit: 1 },
  ));
  assert.deepEqual(preview.result.rows, [{
    name: 'First',
    lat: '59.3',
    lon: '18.1',
  }]);
  const exported = await runtime.handleMessage(request(
    'export-first',
    BROWSER_SQLITE_OPERATIONS.EXPORT_DATASET_CSV,
    { datasetId: firstDatasetId },
  ));
  assert.equal(exported.result.fileName, 'first.csv');
  assert.equal(exported.result.csvText.includes('First,59.3,18.1'), true);
  assert.equal(exported.result.csvText.includes('dataset_id'), false);
  const disabled = await runtime.handleMessage(request(
    'disable-first',
    BROWSER_SQLITE_OPERATIONS.SET_DATASET_ENABLED,
    { datasetId: firstDatasetId, enabled: false },
  ));
  assert.equal(disabled.result.dataset.enabled, false);
  const mapped = await runtime.handleMessage(request(
    'map-first',
    BROWSER_SQLITE_OPERATIONS.UPDATE_DATASET_MAPPING,
    {
      datasetId: firstDatasetId,
      mapping: { latField: 'lat', lonField: 'lon' },
    },
  ));
  assert.deepEqual(mapped.result.mapping, {
    latField: 'lat',
    lonField: 'lon',
  });
  await runtime.handleMessage(request(
    'enable-first',
    BROWSER_SQLITE_OPERATIONS.SET_DATASET_ENABLED,
    { datasetId: firstDatasetId, enabled: true },
  ));
  const exactMap = await runtime.handleMessage(request(
    'query-first',
    BROWSER_SQLITE_OPERATIONS.QUERY_MAP_VIEW,
    {
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      renderBudget: 10,
    },
  ));
  assert.equal(exactMap.result.points.length, 2);
  assert.equal(Object.hasOwn(exactMap.result.points[0], 'row'), false);
  const pointDetails = await runtime.handleMessage(request(
    'details-first',
    BROWSER_SQLITE_OPERATIONS.GET_FEATURE_DETAILS,
    { sourceRef: exactMap.result.points[0].sourceRef },
  ));
  assert.equal(pointDetails.result.row.name, 'First');
  const groupedMap = await runtime.handleMessage(request(
    'group-first',
    BROWSER_SQLITE_OPERATIONS.QUERY_MAP_VIEW,
    {
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      renderBudget: 1,
    },
  ));
  assert.equal(groupedMap.result.points[0].count, 2);
  const groupRows = await runtime.handleMessage(request(
    'group-rows-first',
    BROWSER_SQLITE_OPERATIONS.GET_GROUP_ROWS,
    { groupRef: groupedMap.result.points[0].groupRef, offset: 0, limit: 1 },
  ));
  assert.equal(groupRows.result.rows[0].name, 'First');
  assert.equal(groupRows.result.totalRows, 2);

  const cancelImportPromise = runtime.handleMessage(request(
    'import-cancel-request',
    BROWSER_SQLITE_OPERATIONS.IMPORT_FILES,
    {
      importId: 'import-cancel',
      files: [new TestBrowserFile(createCsvRows(120_000), 'cancel.csv')],
    },
  ));
  const queuedSummaryPromise = runtime.handleMessage(request(
    'summary-queued',
    BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY,
  ));
  const canceledImport = await cancelImportPromise;
  await Promise.all(cancellationPromises);
  const queuedSummary = await queuedSummaryPromise;

  assert.equal(cancellationSent, true);
  assert.equal(responseFor('cancel-unrelated').result.canceled, false);
  assert.equal(responseFor('cancel-active').result.canceled, true);
  assert.equal(canceledImport.result.canceled, true);
  assert.equal(canceledImport.result.successfulCount, 0);
  assert.equal(queuedSummary.result.datasets.length, 1);
  assert.ok(
    messageIndex('import-cancel-request') < messageIndex('summary-queued'),
    'Queued database reads must finish after the active import response.',
  );

  const reusedImport = await runtime.handleMessage(request(
    'import-reused',
    BROWSER_SQLITE_OPERATIONS.IMPORT_FILES,
    {
      importId: 'import-reused',
      files: [new TestBrowserFile(
        'name,lat,lon\nReusable,55.6,13.0',
        'reused.csv',
      )],
    },
  ));
  assert.equal(reusedImport.result.successfulCount, 1);
  const reusedDatasetId = reusedImport.result.results[0].datasetId;
  const removed = await runtime.handleMessage(request(
    'remove-reused',
    BROWSER_SQLITE_OPERATIONS.REMOVE_DATASET,
    { datasetId: reusedDatasetId },
  ));
  assert.equal(removed.result.changed, true);

  const closed = await runtime.handleMessage(request(
    'close-first',
    BROWSER_SQLITE_OPERATIONS.CLOSE,
  ));
  assert.equal(closed.result.closed, true);
  const repeatedClose = await runtime.handleMessage(request(
    'close-repeated',
    BROWSER_SQLITE_OPERATIONS.CLOSE,
  ));
  assert.equal(repeatedClose.result.closed, false);
  const summaryAfterClose = await runtime.handleMessage(request(
    'summary-after-close',
    BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY,
  ));
  assertFailure(summaryAfterClose, 'database-not-initialized');

  const reinitialized = await runtime.handleMessage(request(
    'initialize-after-close',
    BROWSER_SQLITE_OPERATIONS.INITIALIZE,
  ));
  assert.equal(reinitialized.result.reused, false);
  const emptyAfterReinitialize = await runtime.handleMessage(request(
    'summary-after-reinitialize',
    BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY,
  ));
  assert.equal(emptyAfterReinitialize.result.datasets.length, 0);

  const freshMessages = [];
  const freshRuntime = createBrowserSqliteWorkerRuntime({
    initializeSql: initSqlJs,
    postMessage: (message) => freshMessages.push(message),
  });
  await freshRuntime.handleMessage(request(
    'fresh-initialize',
    BROWSER_SQLITE_OPERATIONS.INITIALIZE,
  ));
  const freshSummary = await freshRuntime.handleMessage(request(
    'fresh-summary',
    BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY,
  ));
  assert.equal(freshSummary.result.datasets.length, 0);
  assert.equal(freshMessages.length, 2);
  await freshRuntime.handleMessage(request(
    'fresh-close',
    BROWSER_SQLITE_OPERATIONS.CLOSE,
  ));
} finally {
  restoreFileReader();
}

console.log(
  'Browser SQLite worker runtime lifecycle and cancellation smoke test passed.',
);

function request(requestId, operation, payload = undefined) {
  return payload === undefined
    ? { requestId, operation }
    : { requestId, operation, payload };
}

function responseFor(requestId) {
  return messages.find((message) => (
    message.type === 'response' && message.requestId === requestId
  ));
}

function messageIndex(requestId) {
  return messages.findIndex((message) => (
    message.type === 'response' && message.requestId === requestId
  ));
}

function assertFailure(response, code) {
  assert.equal(response.ok, false);
  assert.equal(response.error.code, code);
  assert.doesNotMatch(response.error.message, /DROP TABLE/);
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
