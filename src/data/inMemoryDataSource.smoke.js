import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
const { createInMemoryDataSource } = await vite.ssrLoadModule(
  '/src/data/inMemoryDataSource.js',
);
const { DATA_SOURCE_METHODS } = await vite.ssrLoadModule(
  '/src/data/dataSource.js',
);

const parsed = {
  headers: ['name', 'lat', 'lon', 'lng', 'year', 'dayOfYear'],
  rows: [{
    name: 'Imported point',
    lat: '59.3',
    lon: '18.1',
    lng: '18.1',
    year: '2020',
    dayOfYear: '10',
  }],
  totalRows: 1,
  parseErrors: ['representative warning'],
};
const initialFiles = [
  {
    id: 'dataset-a',
    name: 'a.csv',
    enabled: true,
    headers: parsed.headers,
    rows: parsed.rows,
    totalRows: 1,
    latField: 'lat',
    lonField: 'lon',
    parseErrors: [],
  },
  {
    id: 'dataset-b',
    name: 'b.csv',
    enabled: true,
    headers: ['name', 'lat', 'lon'],
    rows: [{ name: 'B', lat: '60', lon: '19' }],
    totalRows: 1,
    latField: 'lat',
    lonField: 'lon',
    parseErrors: [],
  },
];
const stateChanges = [];
const dataSource = createInMemoryDataSource({
  files: initialFiles,
  parseFile: async (file) => {
    if (file.fail) throw new Error('C:\\private\\parse failure');
    return file.parsed;
  },
  parseBlob: async () => parsed,
  baseUrl: '/base/',
  fetchImpl: async () => ({
    ok: true,
    headers: { get: () => 'text/csv' },
    blob: async () => new Blob(['name,lat,lon\nExample,1,2']),
  }),
  onStateChange: (state) => stateChanges.push(state),
});

const initialization = dataSource.initialize();
for (const method of Object.values(DATA_SOURCE_METHODS)) {
  assert.equal(typeof dataSource[method], 'function', `Missing method: ${method}`);
}
assert.equal(initialization.ok, true);
assert.equal(initialization.capabilities.persistence, 'temporary');
assert.equal(initialization.capabilities.browserFileImport, true);
assert.equal(initialization.capabilities.nativeFilePickerImport, false);
assert.equal(initialization.capabilities.importCancellation, false);

let summary = dataSource.getDatasetSummary();
assert.equal(summary.selectedDatasetId, 'dataset-a');
assert.equal(summary.datasets.length, 2);
assert.equal(Object.hasOwn(summary.datasets[0], 'rows'), false);

assert.equal(dataSource.selectDataset('dataset-b').ok, true);
assert.equal(dataSource.setDatasetEnabled('dataset-b', false).changed, true);
assert.equal(dataSource.queryMapView().points.length, 1);
assert.equal(dataSource.queryMapView({ datasetIds: [] }).points.length, 0);

const mapping = dataSource.updateDatasetMapping('dataset-a', { lonField: 'lng' });
assert.equal(mapping.ok, true);
assert.deepEqual(mapping.mapping, { latField: 'lat', lonField: 'lng' });
assert.equal(
  dataSource.updateDatasetMapping('dataset-a', { latField: 'missing' }).ok,
  false,
);

assert.deepEqual(dataSource.getPreviewPage({
  datasetId: 'dataset-a',
  offset: 0,
  limit: 1,
}), {
  datasetId: 'dataset-a',
  rows: parsed.rows,
  offset: 0,
  limit: 1,
  totalRows: 1,
  hasMore: false,
});

assert.equal(dataSource.removeDataset('dataset-b').changed, true);
assert.equal(dataSource.getDatasetSummary().selectedDatasetId, 'dataset-a');

const progressEvents = [];
const unsubscribe = dataSource.subscribeImportProgress((progress) => {
  progressEvents.push(progress);
});
const importResult = await dataSource.importBrowserFiles({
  files: [
    { name: 'C:\\private\\good.csv', size: 20, parsed },
    { name: 'bad.csv', size: 10, fail: true },
  ],
});
assert.equal(importResult.ok, true);
assert.equal(importResult.successfulCount, 1);
assert.equal(importResult.failedCount, 1);
assert.equal(importResult.results[0].fileName, 'good.csv');
assert.deepEqual(importResult.results[0].warnings, ['representative warning']);
assert.equal(importResult.results[1].error.message, 'The CSV file could not be imported.');
assert.equal(JSON.stringify(importResult).includes('private'), false);
assert.deepEqual(progressEvents.map((event) => event.state), [
  'started',
  'completed',
  'started',
  'completed',
]);
assert.equal(progressEvents[0].fileName, 'good.csv');
assert.equal(progressEvents[0].completedRows, null);

summary = dataSource.getDatasetSummary();
assert.equal(summary.selectedDatasetId, importResult.results[0].datasetId);
assert.equal(summary.datasets[0].name, 'good.csv');
assert.equal(stateChanges.length > 0, true);

const dropped = await dataSource.importDroppedFiles({
  files: [{
    name: 'drop.csv',
    size: 20,
    parsed: {
      ...parsed,
      rows: [
        { name: 'First', lat: '1', lon: '2' },
        { name: 'Second', lat: '3', lon: '4' },
        { name: 'Third', lat: '5', lon: '6' },
      ],
      totalRows: 3,
    },
  }],
});
assert.equal(dropped.ok, true);
assert.equal(dropped.results[0].fileName, 'drop.csv');
assert.deepEqual(dataSource.getPreviewPage({
  datasetId: dropped.results[0].datasetId,
  offset: 1,
  limit: 1,
}), {
  datasetId: dropped.results[0].datasetId,
  rows: [{ name: 'Second', lat: '3', lon: '4' }],
  offset: 1,
  limit: 1,
  totalRows: 3,
  hasMore: true,
});

const example = await dataSource.importExample({ name: 'examples.csv' });
assert.equal(example.ok, true);
assert.equal(example.results[0].fileName, 'examples.csv');
assert.equal(
  (await dataSource.importExample({ name: '../private.csv' })).ok,
  false,
);

const picker = dataSource.importFromPicker();
assert.equal(picker.ok, false);
assert.equal(picker.error.category, 'backend-unavailable');
assert.equal(picker.error.operation, 'importFromPicker');
const cancellation = dataSource.cancelImport(importResult.importId);
assert.equal(cancellation.ok, false);
assert.equal(cancellation.error.category, 'backend-unavailable');

unsubscribe();
unsubscribe();
const progressCount = progressEvents.length;
await dataSource.importBrowserFiles({ files: [{ name: 'later.csv', parsed }] });
assert.equal(progressEvents.length, progressCount);

dataSource.dispose();
dataSource.dispose();
assert.equal(dataSource.initialize().ok, false);
assert.throws(
  () => dataSource.queryMapView(),
  (error) => (
    error.category === 'backend-unavailable' &&
    error.operation === 'queryMapView' &&
    !JSON.stringify(error).includes('private')
  ),
);

console.log('In-memory DataSource contract smoke test passed.');
} finally {
  await vite.close();
}
