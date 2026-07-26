import assert from 'node:assert/strict';
import { DATA_SOURCE_METHODS } from './dataSource.js';
import { createDesktopSqliteDataSource } from './desktopSqliteDataSource.js';

let progressBridgeListener = null;
let progressCleanupCount = 0;
let droppedFilesRequest = null;
const groupRef = {
  groupId: 'grid:1:2',
  bounds: { north: 10, south: 0, east: 20, west: 0 },
  timeline: null,
  grid: { cellLat: 1, cellLon: 2, cellHeight: 1, cellWidth: 1 },
  sortOrder: 'dataset-source-row',
};

const desktopApi = {
  isDesktop: true,
  getStatus: async () => ({ ok: true, runtime: 'electron' }),
  onCsvImportProgress: (listener) => {
    progressBridgeListener = listener;
    return () => {
      progressCleanupCount += 1;
      progressBridgeListener = null;
    };
  },
  importCsvToSqlite: async () => {
    progressBridgeListener?.({
      state: 'started',
      fileName: 'C:\\private\\places.csv',
      fileNumber: 1,
      totalFiles: 1,
    });
    progressBridgeListener?.({
      state: 'completed',
      fileName: 'C:\\private\\places.csv',
      fileNumber: 1,
      totalFiles: 1,
      ok: true,
    });
    return {
      ok: true,
      results: [{
        ok: true,
        fileName: 'places.csv',
        rowCount: 12,
        importedFeatureCount: 10,
        skippedRowCount: 2,
        parseErrors: ['Parser warning'],
      }],
    };
  },
  importDroppedCsvFiles: async (files) => {
    droppedFilesRequest = files;
    return {
      ok: true,
      results: [{ ok: true, fileName: 'drop.csv', rowCount: 1 }],
    };
  },
  getDatasetSummary: async () => ({
    datasets: [{
      id: 'dataset-1',
      name: 'C:\\private\\places.csv',
      enabled: true,
      headers: ['name', 42, 'lat', 'lon'],
      rowCount: '12',
      totalRows: 12.8,
      importedFeatureCount: 10,
      skippedRowCount: -2,
      importedAt: '2026-07-22T00:00:00.000Z',
    }],
    timeline: { yearMin: '1000', yearMax: 2026.9 },
  }),
  setDatasetEnabled: async () => ({ updated: true, private: 'ignored' }),
  removeDataset: async () => ({ removed: true, private: 'ignored' }),
  queryMapView: async () => ({
    points: [{
      id: 'point-1',
      lat: 59.3,
      lon: 18.1,
      sourceRef: { datasetId: 'dataset-1', rowIndex: 0 },
    }],
  }),
  getFeatureDetails: async () => ({
    featureId: 'point-1',
    row: { name: 'Place' },
    latField: 'lat',
    lonField: 'lon',
  }),
  getGroupRows: async () => ({
    rows: [{ name: 'Place' }],
    offset: 0,
    limit: 1,
    totalRows: 2,
  }),
};

const dataSource = createDesktopSqliteDataSource({ desktopApi });
for (const method of Object.values(DATA_SOURCE_METHODS)) {
  assert.equal(typeof dataSource[method], 'function', `Missing method: ${method}`);
}

const initialization = await dataSource.initialize();
assert.equal(initialization.ok, true);
assert.equal(initialization.capabilities.persistence, 'persistent');
assert.equal(initialization.capabilities.nativeFilePickerImport, true);
assert.equal(initialization.capabilities.droppedFileImport, true);
assert.equal(initialization.capabilities.browserFileImport, false);
assert.equal(initialization.capabilities.datasetMapping, false);
assert.equal(initialization.capabilities.previewPaging, false);

const progressEvents = [];
const unsubscribe = dataSource.subscribeImportProgress((progress) => {
  progressEvents.push(progress);
});
const pickerResult = await dataSource.importFromPicker();
assert.equal(pickerResult.ok, true);
assert.equal(pickerResult.successfulCount, 1);
assert.deepEqual(pickerResult.results[0].warnings, ['Parser warning']);
assert.equal(progressEvents.length, 2);
assert.equal(progressEvents[0].importId, pickerResult.importId);
assert.equal(progressEvents[0].fileName, 'places.csv');
assert.equal(JSON.stringify(pickerResult).includes('private'), false);

const droppedFile = { name: 'drop.csv' };
const droppedResult = await dataSource.importDroppedFiles({ files: [droppedFile] });
assert.equal(droppedResult.ok, true);
assert.deepEqual(droppedFilesRequest, [droppedFile]);

assert.equal(dataSource.importBrowserFiles().error.category, 'backend-unavailable');
assert.equal(dataSource.importExample().error.category, 'backend-unavailable');
assert.equal(dataSource.cancelImport('import-1').error.category, 'backend-unavailable');
assert.equal(dataSource.selectDataset('dataset-1').error.category, 'backend-unavailable');
assert.equal(
  dataSource.updateDatasetMapping('dataset-1', { latField: 'lat' }).error.category,
  'backend-unavailable',
);
assert.throws(
  () => dataSource.getPreviewPage({ datasetId: 'dataset-1' }),
  (error) => error.category === 'backend-unavailable',
);

const summary = await dataSource.getDatasetSummary();
assert.equal(summary.selectedDatasetId, null);
assert.equal(summary.datasets[0].name, 'places.csv');
assert.deepEqual(summary.datasets[0].headers, ['name', 'lat', 'lon']);
assert.equal(summary.datasets[0].skippedRowCount, null);
assert.equal(JSON.stringify(summary).includes('private'), false);

assert.equal(
  (await dataSource.setDatasetEnabled(' dataset-1 ', false)).changed,
  true,
);
assert.equal((await dataSource.removeDataset(' dataset-1 ')).changed, true);

const mapView = await dataSource.queryMapView({ renderBudget: 10 });
assert.equal(mapView.points.length, 1);
assert.deepEqual(mapView.points[0].sourceRef, {
  datasetId: 'dataset-1',
  rowIndex: 0,
});
assert.deepEqual(await dataSource.getFeatureDetails({
  sourceRef: { datasetId: 'dataset-1', rowIndex: 0 },
}), {
  featureId: 'point-1',
  row: { name: 'Place' },
  latField: 'lat',
  lonField: 'lon',
});
assert.deepEqual(await dataSource.getGroupRows({
  groupRef,
  offset: 0,
  limit: 1,
}), {
  rows: [{ name: 'Place' }],
  offset: 0,
  limit: 1,
  totalRows: 2,
  hasMore: true,
});

unsubscribe();
unsubscribe();
assert.equal(progressCleanupCount, 1);

const unavailable = createDesktopSqliteDataSource({ desktopApi: null });
assert.equal((await unavailable.initialize()).ok, false);
assert.equal(
  (await unavailable.importFromPicker()).error.category,
  'backend-unavailable',
);
await assert.rejects(
  unavailable.getDatasetSummary(),
  (error) => error.category === 'backend-unavailable',
);

dataSource.dispose();
dataSource.dispose();
await assert.rejects(
  dataSource.queryMapView(),
  (error) => error.category === 'backend-unavailable',
);

console.log('Desktop SQLite DataSource contract smoke test passed.');
