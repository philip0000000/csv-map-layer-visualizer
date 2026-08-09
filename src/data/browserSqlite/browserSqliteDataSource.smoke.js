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

  exportDatasetCsv(datasetId) {
    this.calls.push(['exportDatasetCsv', datasetId]);
    return this.result({
      datasetId,
      fileName: 'first.csv',
      csvText: 'name\nFirst',
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

  queryMapView(query) {
    this.calls.push(['queryMapView', query]);
    return this.result({
      points: [{
        id: 'dataset-1:0',
        renderType: 'exact',
        lat: 1,
        lon: 2,
        count: 1,
        sourceRef: { datasetId: 'dataset-1', rowIndex: 0 },
        marker: 'blue',
        row: { mustNotEscape: true },
      }],
      lines: [],
      regions: [],
      stats: { totalMatchingCount: 1, returnedCount: 1 },
      timelineIndex: { entries: [] },
    });
  }

  getFeatureDetails(query) {
    this.calls.push(['getFeatureDetails', query]);
    return this.result({
      featureId: 'dataset-1:0',
      row: { name: 'One', count: 2 },
      latField: 'lat',
      lonField: 'lon',
    });
  }

  getGroupRows(query) {
    this.calls.push(['getGroupRows', query]);
    return this.result({
      rows: [{ name: 'One', count: 2 }],
      offset: query.offset ?? 0,
      limit: query.limit ?? 30,
      totalRows: 1,
    });
  }

  getLogicalZone(query) {
    this.calls.push(['getLogicalZone', query]);
    return this.result({
      ...query,
      parts: [{
        part: 'main',
        coordinates: [[1, 1], [1, 2], [2, 1], [1, 1]],
        style: { color: '#3388ff' },
      }],
    });
  }

  updateLogicalZone(request) {
    this.calls.push(['updateLogicalZone', request]);
    return this.result(request);
  }

  dispose() {
    this.disposeCount += 1;
  }

  result(value) {
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(value);
  }
}

const client = new FakeWorkerClient();
const downloads = [];
const dataSource = createBrowserSqliteDataSource({
  client,
  downloadCsv: (csvText, fileName) => downloads.push({ csvText, fileName }),
  baseUrl: '/',
  fetchImpl: async (url) => ({
    ok: url === '/examples/present-day/books.csv',
    headers: { get: () => 'text/csv' },
    blob: async () => new Blob(['name,lat,lon\nBook,1,2'], { type: 'text/csv' }),
  }),
});
assert.deepEqual(
  new Set(Object.keys(dataSource)),
  new Set(Object.values(DATA_SOURCE_METHODS)),
);

const initialized = await dataSource.initialize();
assert.equal(initialized.ok, true);
assert.equal(initialized.capabilities.persistence, 'temporary');
assert.equal(initialized.capabilities.browserFileImport, true);
assert.equal(initialized.capabilities.droppedFileImport, true);
assert.equal(initialized.capabilities.exampleImport, true);
assert.equal(initialized.capabilities.datasetSelection, true);
assert.equal(initialized.capabilities.previewPaging, true);
assert.equal(initialized.capabilities.points, true);
assert.equal(initialized.capabilities.lines, true);
assert.equal(initialized.capabilities.regions, true);
assert.equal(initialized.capabilities.groupedViewportResults, true);
assert.equal(initialized.capabilities.zoneEditing, true);
assert.equal(initialized.capabilities.datasetCsvExport, true);
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
const invalidExample = await dataSource.importExample();
assert.equal(invalidExample.error.operation, DATA_SOURCE_METHODS.importExample);
const example = await dataSource.importExample({
  name: 'present-day/books.csv',
});
assert.equal(example.ok, true);
assert.equal(client.calls.at(-1)[1][0].name, 'books.csv');

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
const saved = await dataSource.saveDatasetAsCsv('dataset-1');
assert.equal(saved.ok, true);
assert.equal(saved.fileName, 'first.csv');
assert.deepEqual(downloads, [{ csvText: 'name\nFirst', fileName: 'first.csv' }]);
assert.deepEqual(client.calls.at(-1), ['exportDatasetCsv', 'dataset-1']);
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

const mapView = await dataSource.queryMapView({
  bounds: { north: 10, south: 0, east: 10, west: 0 },
});
assert.equal(mapView.points.length, 1);
assert.equal(Object.hasOwn(mapView.points[0], 'row'), false);
assert.deepEqual(client.calls.at(-1), [
  'queryMapView',
  { bounds: { north: 10, south: 0, east: 10, west: 0 } },
]);
const featureDetails = await dataSource.getFeatureDetails({
  sourceRef: { datasetId: 'dataset-1', rowIndex: 0 },
});
assert.deepEqual(featureDetails.row, { name: 'One', count: '2' });
const groupRows = await dataSource.getGroupRows({ offset: 0, limit: 1 });
const logicalZone = await dataSource.getLogicalZone({
  datasetId: 'dataset-1',
  featureId: 'zone',
});
assert.equal(logicalZone.parts.length, 1);
assert.deepEqual(await dataSource.updateLogicalZone(logicalZone), logicalZone);
assert.deepEqual(groupRows.rows, [{ name: 'One', count: '2' }]);

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
await assert.rejects(dataSource.queryMapView(), (error) => (
  error.category === 'backend-unavailable'
));
const disposedInitialization = await dataSource.initialize();
assert.equal(disposedInitialization.ok, false);

const failedCreation = createBrowserSqliteDataSource({
  createClient: () => {
    throw new Error('private worker construction failure');
  },
});
const failedInitialization = await failedCreation.initialize();
assert.equal(failedInitialization.ok, false);
assert.equal(failedInitialization.error.category, 'initialization-failed');
assert.equal(
  JSON.stringify(failedInitialization).includes('private worker construction failure'),
  false,
);
failedCreation.dispose();

class SelectionWorkerClient {
  constructor() {
    this.datasets = [dataset('existing-dataset', 'existing.csv')];
    this.queuedResults = [];
    this.importSequence = 0;
  }

  enqueue(results) {
    this.queuedResults.push(results);
  }

  startImport() {
    const results = this.queuedResults.shift() ?? [];
    for (const result of results) {
      if (result.ok && result.datasetId) {
        this.datasets.push(dataset(result.datasetId, result.fileName));
      }
    }
    const importId = `selection-import-${this.importSequence += 1}`;
    return {
      importId,
      result: Promise.resolve({ importId, results }),
    };
  }

  getDatasetSummary() {
    return Promise.resolve({ datasets: this.datasets });
  }

  dispose() {}
}

function importedFile(datasetId, fileName) {
  return {
    ok: true,
    datasetId,
    fileName,
    rowCount: 1,
  };
}

function failedFile(fileName) {
  return {
    ok: false,
    fileName,
  };
}

const selectionClient = new SelectionWorkerClient();
const selectionDataSource = createBrowserSqliteDataSource({
  client: selectionClient,
});
let selectionSummary = await selectionDataSource.getDatasetSummary();
assert.equal(selectionSummary.selectedDatasetId, 'existing-dataset');

selectionClient.enqueue([
  importedFile('new-first', 'new-first.csv'),
  importedFile('new-second', 'new-second.csv'),
]);
await selectionDataSource.importBrowserFiles({ files: [{}, {}] });
selectionSummary = await selectionDataSource.getDatasetSummary();
assert.equal(selectionSummary.selectedDatasetId, 'new-first');

selectionClient.enqueue([
  failedFile('broken.csv'),
  importedFile('mixed-success', 'working.csv'),
]);
await selectionDataSource.importBrowserFiles({ files: [{}, {}] });
selectionSummary = await selectionDataSource.getDatasetSummary();
assert.equal(selectionSummary.selectedDatasetId, 'mixed-success');

selectionClient.enqueue([
  failedFile('still-broken.csv'),
]);
await selectionDataSource.importBrowserFiles({ files: [{}] });
selectionSummary = await selectionDataSource.getDatasetSummary();
assert.equal(selectionSummary.selectedDatasetId, 'mixed-success');
selectionDataSource.dispose();

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
