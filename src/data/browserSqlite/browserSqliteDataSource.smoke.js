import assert from 'node:assert/strict';
import {
  DATA_SOURCE_METHODS,
} from '../dataSource.js';
import {
  createBrowserSqliteDataSource,
} from './browserSqliteDataSource.js';

class FakeWorkerClient {
  constructor() {
    this.calls = [];
    this.datasets = [
      dataset('dataset-1', 'first.csv'),
      dataset('dataset-2', 'second.csv'),
    ];
    this.importSequence = 0;
    this.disposeCount = 0;
    this.failure = null;
  }

  initialize() {
    this.calls.push(['initialize']);
    return this.result({ initialized: true });
  }

  startImport(files, options) {
    const importId = `adapter-import-${this.importSequence += 1}`;
    this.calls.push(['startImport', files, importId]);
    options.onProgress({
      importId,
      state: 'unknown',
      fileName: 'ignored.csv',
      fileNumber: 1,
      totalFiles: 1,
    });
    options.onProgress({
      importId,
      state: 'completed',
      fileName: files[0]?.name ?? 'unknown.csv',
      fileNumber: 1,
      totalFiles: 1,
      completedRows: 1,
      totalRows: 1,
      ok: true,
    });
    const value = {
      ok: true,
      importId,
      canceled: false,
      successfulCount: 99,
      failedCount: 99,
      results: [{
        ok: true,
        fileName: files[0]?.name ?? 'unknown.csv',
        datasetId: 'imported-dataset',
        rowCount: 1,
        importedFeatureCount: 0,
        skippedRowCount: 0,
        warnings: [],
        detectedFields: null,
        rows: [{ mustNotEscape: true }],
        error: null,
      }],
      error: null,
    };
    return {
      importId,
      result: this.failure
        ? Promise.reject(this.failure)
        : Promise.resolve(value),
      cancel: () => this.cancelImport(importId),
    };
  }

  cancelImport(importId) {
    this.calls.push(['cancelImport', importId]);
    return this.result({ importId, canceled: importId === 'active-import' });
  }

  getDatasetSummary() {
    this.calls.push(['getDatasetSummary']);
    return this.result({
      datasets: this.datasets,
      selectedDatasetId: 'worker-selection-must-be-ignored',
      timeline: null,
    });
  }

  setDatasetEnabled(datasetId, enabled) {
    this.calls.push(['setDatasetEnabled', datasetId, enabled]);
    const stored = this.datasets.find((item) => item.id === datasetId);
    if (!stored) return Promise.reject({ code: 'dataset-not-found' });
    stored.enabled = enabled;
    return this.result({
      ok: true,
      datasetId,
      changed: true,
      dataset: stored,
      error: null,
    });
  }

  removeDataset(datasetId) {
    this.calls.push(['removeDataset', datasetId]);
    if (!this.datasets.some((item) => item.id === datasetId)) {
      return Promise.reject({ code: 'dataset-not-found' });
    }
    this.datasets = this.datasets.filter((item) => item.id !== datasetId);
    return this.result({
      ok: true,
      datasetId,
      changed: true,
      dataset: null,
      error: null,
    });
  }

  updateDatasetMapping(datasetId, mapping) {
    this.calls.push(['updateDatasetMapping', datasetId, mapping]);
    if (this.failure) return Promise.reject(this.failure);
    const stored = this.datasets.find((item) => item.id === datasetId);
    return Promise.resolve({
      ok: true,
      datasetId,
      mapping,
      detectedFields: stored.detectedFields,
      dataset: { ...stored, ...mapping },
      error: null,
    });
  }

  getPreviewPage(datasetId, page) {
    this.calls.push(['getPreviewPage', datasetId, page]);
    return this.result({
      datasetId,
      rows: [{ name: 'One', count: 2 }],
      offset: page.offset ?? 0,
      limit: page.limit ?? 30,
      totalRows: 2,
      hasMore: true,
    });
  }

  dispose() {
    this.disposeCount += 1;
  }

  result(value) {
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(value);
  }
}

const client = new FakeWorkerClient();
const dataSource = createBrowserSqliteDataSource({ client });
assert.deepEqual(
  new Set(Object.keys(dataSource)),
  new Set(Object.values(DATA_SOURCE_METHODS)),
);

const initialized = await dataSource.initialize();
assert.equal(initialized.ok, true);
assert.equal(initialized.capabilities.persistence, 'temporary');
assert.equal(initialized.capabilities.browserFileImport, true);
assert.equal(initialized.capabilities.droppedFileImport, true);
assert.equal(initialized.capabilities.datasetSelection, true);
assert.equal(initialized.capabilities.previewPaging, true);
assert.equal(initialized.capabilities.points, false);
assert.deepEqual(dataSource.getCapabilities(), initialized.capabilities);

const observedProgress = [];
const unsubscribe = dataSource.subscribeImportProgress((progress) => {
  observedProgress.push(progress);
});
dataSource.subscribeImportProgress(() => {
  throw new Error('A progress observer must not interrupt the import.');
});
const imported = await dataSource.importBrowserFiles({
  files: [{ name: 'safe.csv' }],
});
assert.equal(imported.ok, true);
assert.equal(imported.successfulCount, 1);
assert.equal(imported.failedCount, 0);
assert.equal(Object.hasOwn(imported.results[0], 'rows'), false);
assert.deepEqual(observedProgress.map((item) => item.state), ['completed']);
unsubscribe();
unsubscribe();

const dropped = await dataSource.importDroppedFiles({
  files: [{ name: 'dropped.csv' }],
});
assert.equal(dropped.ok, true);
assert.equal(client.calls.at(-1)[0], 'startImport');
const picker = dataSource.importFromPicker();
assert.equal(picker.ok, false);
assert.equal(picker.error.category, 'backend-unavailable');
const example = dataSource.importExample();
assert.equal(example.error.operation, DATA_SOURCE_METHODS.importExample);

const canceled = await dataSource.cancelImport('active-import');
assert.equal(canceled.ok, true);
assert.equal(canceled.canceled, true);
const notCanceled = await dataSource.cancelImport('inactive-import');
assert.equal(notCanceled.ok, false);

let summary = await dataSource.getDatasetSummary();
assert.equal(summary.selectedDatasetId, 'dataset-1');
assert.equal(summary.datasets.length, 2);
const selected = await dataSource.selectDataset('dataset-2');
assert.equal(selected.ok, true);
assert.equal(selected.changed, true);
summary = await dataSource.getDatasetSummary();
assert.equal(summary.selectedDatasetId, 'dataset-2');
const missingSelection = await dataSource.selectDataset('missing');
assert.equal(missingSelection.ok, false);
assert.equal(missingSelection.error.category, 'dataset-not-found');

const disabled = await dataSource.setDatasetEnabled('dataset-2', false);
assert.equal(disabled.ok, true);
assert.equal(disabled.dataset.enabled, false);
const invalidVisibility = await dataSource.setDatasetEnabled('', false);
assert.equal(invalidVisibility.ok, false);
const mapped = await dataSource.updateDatasetMapping('dataset-2', {
  latField: 'lat',
  lonField: 'lon',
});
assert.equal(mapped.ok, true);
assert.deepEqual(mapped.mapping, { latField: 'lat', lonField: 'lon' });

const preview = await dataSource.getPreviewPage({
  datasetId: 'dataset-2',
  offset: 0,
  limit: 1,
});
assert.deepEqual(preview.rows, [{ name: 'One', count: '2' }]);
assert.equal(preview.hasMore, true);
assert.deepEqual(client.calls.at(-1), [
  'getPreviewPage',
  'dataset-2',
  { offset: 0, limit: 1 },
]);

const removed = await dataSource.removeDataset('dataset-2');
assert.equal(removed.ok, true);
summary = await dataSource.getDatasetSummary();
assert.equal(summary.selectedDatasetId, 'dataset-1');
const missingRemoval = await dataSource.removeDataset('dataset-2');
assert.equal(missingRemoval.error.category, 'dataset-not-found');

for (const method of ['queryMapView', 'getFeatureDetails', 'getGroupRows']) {
  assert.throws(() => dataSource[method](), (error) => (
    error.category === 'backend-unavailable' &&
    error.operation === DATA_SOURCE_METHODS[method]
  ));
}

client.failure = { code: 'invalid-mapping', message: 'private detail' };
const invalidMapping = await dataSource.updateDatasetMapping('dataset-1', {
  latField: 'missing',
  lonField: 'lon',
});
assert.equal(invalidMapping.ok, false);
assert.equal(invalidMapping.error.category, 'invalid-mapping');
assert.equal(JSON.stringify(invalidMapping).includes('private detail'), false);

client.failure = { code: 'worker-unavailable', message: 'worker stack' };
const unavailableImport = await dataSource.importBrowserFiles({
  files: [{ name: 'unavailable.csv' }],
});
assert.equal(unavailableImport.error.category, 'backend-unavailable');
await assert.rejects(dataSource.getDatasetSummary(), (error) => (
  error.category === 'backend-unavailable' &&
  !error.message.includes('worker stack')
));
client.failure = null;

dataSource.dispose();
dataSource.dispose();
assert.equal(client.disposeCount, 1);
assert.throws(() => dataSource.queryMapView(), (error) => (
  error.category === 'backend-unavailable'
));
const disposedInitialization = await dataSource.initialize();
assert.equal(disposedInitialization.ok, false);

console.log('Browser SQLite data-source adapter contract smoke test passed.');

function dataset(id, name) {
  return {
    id,
    name,
    enabled: true,
    headers: ['name', 'lat', 'lon'],
    rowCount: 1,
    totalRows: 1,
    sizeBytes: 10,
    importedFeatureCount: 0,
    skippedRowCount: 0,
    importedAt: '2026-07-26T16:00:00.000Z',
    latField: 'lat',
    lonField: 'lon',
    detectedFields: {
      latField: 'lat',
      lonField: 'lon',
      yearField: null,
      dateField: null,
      dayOfYearField: null,
      yearFromField: null,
      yearToField: null,
      dateFromField: null,
      dateToField: null,
    },
    parseErrors: [],
  };
}
