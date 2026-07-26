import assert from 'node:assert/strict';
import {
  BROWSER_SQLITE_OPERATIONS,
  createBrowserSqliteFailureResponse,
  createBrowserSqliteProgressEvent,
  createBrowserSqliteSuccessResponse,
} from './browserSqliteProtocol.js';
import {
  BrowserSqliteWorkerClientError,
  createBrowserSqliteWorkerClient,
} from './browserSqliteWorkerClient.js';

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.posted = [];
    this.terminateCount = 0;
    this.throwNextPost = false;
  }

  addEventListener(type, listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message) {
    if (this.throwNextPost) {
      this.throwNextPost = false;
      throw new DOMException('Could not clone request.', 'DataCloneError');
    }
    this.posted.push(message);
  }

  terminate() {
    this.terminateCount += 1;
  }

  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  emitMessage(data) {
    this.emit('message', { data });
  }

  listenerCount() {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }
}

class TestBrowserFile {
  constructor(name) {
    this.name = name;
    this.size = 10;
    this.type = 'text/csv';
    this.lastModified = 1_750_000_000_000;
  }

  slice() {
    return new Blob(['name,lat,lon\nOne,1,2']);
  }
}

const worker = new FakeWorker();
let requestSequence = 0;
let importSequence = 0;
const client = createBrowserSqliteWorkerClient({
  worker,
  createRequestId: () => `request-${requestSequence += 1}`,
  createImportId: () => `import-${importSequence += 1}`,
});

const initializePromise = client.initialize();
assert.deepEqual(worker.posted.at(-1), {
  requestId: 'request-1',
  operation: BROWSER_SQLITE_OPERATIONS.INITIALIZE,
  payload: {},
});
respondSuccess(worker, worker.posted.at(-1), {
  initialized: true,
  reused: false,
  databaseStorage: 'memory',
  schemaVersion: 1,
});
assert.equal((await initializePromise).initialized, true);

const summaryPromise = client.getDatasetSummary();
const previewPromise = client.getPreviewPage('dataset-1', {
  datasetId: 'cannot-override',
  offset: 10,
  limit: 5,
});
const summaryRequest = worker.posted.at(-2);
const previewRequest = worker.posted.at(-1);
assert.equal(summaryRequest.requestId, 'request-2');
assert.deepEqual(previewRequest.payload, {
  datasetId: 'dataset-1',
  offset: 10,
  limit: 5,
});
respondSuccess(worker, previewRequest, {
  datasetId: 'dataset-1',
  rows: [],
  offset: 10,
  limit: 5,
  totalRows: 0,
  hasMore: false,
});
respondSuccess(worker, summaryRequest, {
  datasets: [{ id: 'dataset-1' }],
  selectedDatasetId: null,
  timeline: null,
});
assert.equal((await previewPromise).datasetId, 'dataset-1');
assert.equal((await summaryPromise).datasets[0].id, 'dataset-1');

const inlineProgress = [];
const subscribedProgress = [];
const unsubscribe = client.subscribeImportProgress(
  'import-1',
  (progress) => subscribedProgress.push(progress.state),
);
client.subscribeImportProgress('import-1', () => {
  throw new Error('A progress listener must not interrupt other listeners.');
});
const importTask = client.startImport(
  [new TestBrowserFile('safe.csv')],
  { onProgress: (progress) => inlineProgress.push(progress.state) },
);
assert.equal(importTask.importId, 'import-1');
const importRequest = worker.posted.at(-1);
assert.equal(importRequest.operation, BROWSER_SQLITE_OPERATIONS.IMPORT_FILES);
assert.equal(importRequest.payload.importId, 'import-1');
assert.throws(
  () => client.startImport(
    [new TestBrowserFile('duplicate.csv')],
    { importId: 'import-1' },
  ),
  (error) => (
    error instanceof BrowserSqliteWorkerClientError &&
    error.code === 'invalid-request'
  ),
);

const storingProgress = createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'storing',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 1,
  completedRows: 1,
  totalRows: null,
});
worker.emitMessage({ ...storingProgress, rows: [{ private: true }] });
assert.deepEqual(inlineProgress, []);
worker.emitMessage(storingProgress);
assert.deepEqual(inlineProgress, ['storing']);
assert.deepEqual(subscribedProgress, ['storing']);

const cancelPromise = importTask.cancel();
const cancelRequest = worker.posted.at(-1);
assert.deepEqual(cancelRequest.payload, { importId: 'import-1' });
respondSuccess(worker, cancelRequest, { importId: 'import-1', canceled: true });
assert.equal((await cancelPromise).canceled, true);
respondSuccess(worker, importRequest, {
  ok: false,
  importId: 'import-1',
  canceled: true,
  successfulCount: 0,
  failedCount: 1,
  results: [],
  error: { code: 'import-canceled', message: 'Import canceled.' },
});
assert.equal((await importTask.result).canceled, true);
worker.emitMessage(storingProgress);
assert.deepEqual(inlineProgress, ['storing']);
assert.deepEqual(subscribedProgress, ['storing', 'storing']);
assert.equal(unsubscribe(), true);
assert.equal(unsubscribe(), false);

await completeSuccess(worker, client.setDatasetEnabled('dataset-1', false), {
  ok: true,
  datasetId: 'dataset-1',
  changed: true,
  dataset: { id: 'dataset-1', enabled: false },
  error: null,
});
assert.deepEqual(worker.posted.at(-1).payload, {
  datasetId: 'dataset-1',
  enabled: false,
});
await completeSuccess(
  worker,
  client.updateDatasetMapping('dataset-1', {
    latField: 'lat',
    lonField: 'lon',
  }),
  {
    ok: true,
    datasetId: 'dataset-1',
    mapping: { latField: 'lat', lonField: 'lon' },
    detectedFields: {},
    dataset: { id: 'dataset-1' },
    error: null,
  },
);
assert.equal(
  worker.posted.at(-1).operation,
  BROWSER_SQLITE_OPERATIONS.UPDATE_DATASET_MAPPING,
);

const removeFailurePromise = client.removeDataset('missing-dataset');
const removeFailureRequest = worker.posted.at(-1);
worker.emitMessage(createBrowserSqliteFailureResponse(
  removeFailureRequest.requestId,
  'dataset-not-found',
));
await assertClientError(removeFailurePromise, 'dataset-not-found');

const malformedPromise = client.getDatasetSummary();
const malformedRequest = worker.posted.at(-1);
worker.emitMessage({
  ...createBrowserSqliteSuccessResponse(malformedRequest.requestId, {
    datasets: [],
  }),
  database: { private: true },
});
await assertClientError(malformedPromise, 'operation-failed');

const healthyAfterMalformed = client.getDatasetSummary();
respondSuccess(worker, worker.posted.at(-1), {
  datasets: [],
  selectedDatasetId: null,
  timeline: null,
});
assert.deepEqual((await healthyAfterMalformed).datasets, []);

worker.throwNextPost = true;
await assertClientError(client.getDatasetSummary(), 'operation-failed');
const healthyAfterCloneFailure = client.getDatasetSummary();
respondSuccess(worker, worker.posted.at(-1), {
  datasets: [],
  selectedDatasetId: null,
  timeline: null,
});
await healthyAfterCloneFailure;

const closePromise = client.close();
assert.equal(worker.posted.at(-1).operation, BROWSER_SQLITE_OPERATIONS.CLOSE);
respondSuccess(worker, worker.posted.at(-1), { closed: true });
assert.equal((await closePromise).closed, true);
assert.equal(worker.terminateCount, 0);

const pendingSummary = client.getDatasetSummary();
const pendingInitialize = client.initialize();
const pendingSummaryRejection = assertClientError(
  pendingSummary,
  'worker-unavailable',
);
const pendingInitializeRejection = assertClientError(
  pendingInitialize,
  'worker-unavailable',
);
assert.equal(client.dispose(), true);
await Promise.all([pendingSummaryRejection, pendingInitializeRejection]);
assert.equal(client.dispose(), false);
assert.equal(worker.terminateCount, 1);
assert.equal(worker.listenerCount(), 0);
await assertClientError(client.initialize(), 'worker-unavailable');

const crashWorker = new FakeWorker();
const crashClient = createBrowserSqliteWorkerClient({ worker: crashWorker });
const crashRequest = crashClient.getDatasetSummary();
const crashRejection = assertClientError(crashRequest, 'worker-unavailable');
let defaultPrevented = false;
crashWorker.emit('error', {
  preventDefault: () => {
    defaultPrevented = true;
  },
});
await crashRejection;
assert.equal(defaultPrevented, true);
assert.equal(crashWorker.terminateCount, 1);
assert.equal(crashWorker.listenerCount(), 0);
await assertClientError(crashClient.close(), 'worker-unavailable');

const messageErrorWorker = new FakeWorker();
const messageErrorClient = createBrowserSqliteWorkerClient({
  worker: messageErrorWorker,
});
const messageErrorRequest = messageErrorClient.initialize();
const messageErrorRejection = assertClientError(
  messageErrorRequest,
  'worker-unavailable',
);
messageErrorWorker.emit('messageerror', {});
await messageErrorRejection;
assert.equal(messageErrorWorker.terminateCount, 1);

assert.throws(
  () => createBrowserSqliteWorkerClient({ worker: {} }),
  /Worker-compatible/,
);

console.log(
  'Browser SQLite main-thread worker client lifecycle smoke test passed.',
);

function respondSuccess(targetWorker, request, result) {
  targetWorker.emitMessage(createBrowserSqliteSuccessResponse(
    request.requestId,
    result,
  ));
}

async function completeSuccess(targetWorker, promise, result) {
  respondSuccess(targetWorker, targetWorker.posted.at(-1), result);
  return promise;
}

function assertClientError(promise, code) {
  return assert.rejects(promise, (error) => (
    error instanceof BrowserSqliteWorkerClientError &&
    error.code === code &&
    !String(error.message).includes('Could not clone')
  ));
}
