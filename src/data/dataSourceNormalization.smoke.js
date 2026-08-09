import assert from 'node:assert/strict';

import {
  BACKEND_FAILURE_CATEGORIES,
  DATA_SOURCE_METHODS,
} from './dataSource.js';
import {
  normalizeBackendCapabilities,
  normalizeBackendFailure,
  normalizeDatasetCsvSaveResult,
  normalizeDatasetMutationResult,
  normalizeDatasetSummary,
  normalizeFeatureDetailsResult,
  normalizeGroupRowsResult,
  normalizeImportBatchResult,
  normalizeImportCancellationResult,
  normalizeImportProgress,
  normalizeInitializationResult,
  normalizeMapViewResult,
  normalizeMappingMutationResult,
  normalizePreviewPageResult,
} from './dataSourceNormalization.js';

const rawSecret = new Error(
  'SELECT * FROM datasets at C:\\private\\map.sqlite via desktop:queryMapView',
);
const failure = normalizeBackendFailure(rawSecret, {
  category: BACKEND_FAILURE_CATEGORIES.QUERY_FAILED,
  operation: DATA_SOURCE_METHODS.queryMapView,
  message: 'Map query failed.',
  recoverable: true,
});
assert.deepEqual(failure, {
  category: 'query-failed',
  message: 'Map query failed.',
  operation: 'queryMapView',
  recoverable: true,
  datasetId: null,
  importId: null,
});
assert.equal(JSON.stringify(failure).includes('SELECT'), false);
assert.equal(JSON.stringify(failure).includes('map.sqlite'), false);

const capabilities = normalizeBackendCapabilities({
  persistence: 'persistent',
  browserFileImport: 1,
  nativeFilePickerImport: true,
  points: true,
});
assert.equal(Object.isFrozen(capabilities), true);
assert.equal(capabilities.persistence, 'persistent');
assert.equal(capabilities.browserFileImport, false);
assert.equal(capabilities.nativeFilePickerImport, true);
assert.equal(capabilities.points, true);
assert.equal(capabilities.lines, false);
assert.equal(capabilities.datasetCsvExport, false);

assert.deepEqual(normalizeDatasetCsvSaveResult({
  ok: true,
  datasetId: 'dataset-1',
  fileName: 'places.csv',
}, 'dataset-1'), {
  ok: true,
  canceled: false,
  datasetId: 'dataset-1',
  fileName: 'places.csv',
  error: null,
});
assert.equal(normalizeDatasetCsvSaveResult({
  canceled: true,
}, 'dataset-1').error, null);

const initialization = normalizeInitializationResult({
  ok: false,
  capabilities: { persistence: 'persistent' },
  error: rawSecret,
});
assert.equal(initialization.ok, false);
assert.equal(initialization.error.category, 'initialization-failed');
assert.equal(JSON.stringify(initialization).includes('private'), false);

assert.deepEqual(normalizeImportProgress({
  importId: 'import-1',
  state: 'completed',
  fileName: 'C:\\private\\places.csv',
  fileNumber: 1,
  totalFiles: 2,
  completedRows: '12',
  totalRows: 12.9,
  ok: true,
}), {
  importId: 'import-1',
  state: 'completed',
  fileName: 'places.csv',
  fileNumber: 1,
  totalFiles: 2,
  completedRows: 12,
  totalRows: 12,
  ok: true,
});
assert.equal(normalizeImportProgress({ state: 'started' }), null);

const importResult = normalizeImportBatchResult({
  importId: 'batch-1',
  results: [
    {
      ok: true,
      fileName: 'C:\\private\\good.csv',
      datasetId: 'dataset-1',
      rowCount: '10',
      importedFeatureCount: 8.9,
      skippedRowCount: 2,
      parseErrors: ['Parser warning'],
      detectedFields: { latField: 'lat', lonField: 'lon', yearField: 'year' },
    },
    { ok: false, fileName: '/private/bad.csv', error: rawSecret },
  ],
}, { operation: DATA_SOURCE_METHODS.importFromPicker });
assert.equal(importResult.ok, true);
assert.equal(importResult.successfulCount, 1);
assert.equal(importResult.failedCount, 1);
assert.equal(importResult.results[0].fileName, 'good.csv');
assert.equal(importResult.results[0].importedFeatureCount, 8);
assert.deepEqual(importResult.results[0].warnings, ['Parser warning']);
assert.equal(importResult.results[1].fileName, 'bad.csv');
assert.equal(importResult.results[1].error.operation, 'importFromPicker');
assert.equal(JSON.stringify(importResult).includes('private'), false);

const cancellation = normalizeImportCancellationResult(null, 'batch-1');
assert.equal(cancellation.ok, false);
assert.equal(cancellation.error.category, 'backend-unavailable');

const datasetSummary = normalizeDatasetSummary({
  selectedDatasetId: 'dataset-1',
  datasets: [
    {
      id: 'dataset-1',
      name: 'C:\\private\\places.csv',
      enabled: true,
      headers: ['name', 42, 'lat', 'lon'],
      rowCount: '12',
      totalRows: 15.8,
      size: 1024,
      importedFeatureCount: 10,
      skippedRowCount: -4,
      latField: 'lat',
      lonField: 'lon',
      detectedFields: { dayOfYearField: 'doy' },
      recommendedTimelineRange: { startYear: 2025, endYear: 1000 },
      parseErrors: ['warning'],
      rows: [{ secret: 'must not pass through' }],
    },
    { id: 'dataset-1', name: 'duplicate.csv' },
    { id: '', name: 'invalid.csv' },
  ],
  timeline: { yearMin: 2025, yearMax: '1000' },
});
assert.equal(datasetSummary.datasets.length, 1);
assert.equal(datasetSummary.datasets[0].name, 'places.csv');
assert.equal(datasetSummary.datasets[0].rowCount, 12);
assert.equal(datasetSummary.datasets[0].totalRows, 15);
assert.equal(datasetSummary.datasets[0].skippedRowCount, null);
assert.deepEqual(datasetSummary.datasets[0].recommendedTimelineRange, {
  startYear: 1000,
  endYear: 2025,
});
assert.equal(Object.hasOwn(datasetSummary.datasets[0], 'rows'), false);
assert.equal(datasetSummary.selectedDatasetId, 'dataset-1');
assert.deepEqual(datasetSummary.timeline, { yearMin: 1000, yearMax: 2025 });

const wideHeaders = Array.from({ length: 201 }, (_, index) => `column-${index}`);
assert.equal(
  normalizeDatasetSummary({
    datasets: [{ id: 'wide', name: 'wide.csv', headers: wideHeaders }],
  }).datasets[0].headers.length,
  201,
  'dataset headers must not be truncated by the diagnostic-list safety limit',
);

assert.deepEqual(normalizeDatasetMutationResult(
  { updated: true },
  { datasetId: 'dataset-1', operation: DATA_SOURCE_METHODS.setDatasetEnabled },
), {
  ok: true,
  datasetId: 'dataset-1',
  changed: true,
  dataset: null,
  error: null,
});

const mappingFailure = normalizeMappingMutationResult({ error: rawSecret }, 'dataset-1');
assert.equal(mappingFailure.ok, false);
assert.equal(mappingFailure.error.category, 'invalid-mapping');
assert.equal(JSON.stringify(mappingFailure).includes('SELECT'), false);

const unsafeRow = Object.create(null);
unsafeRow.name = 'A';
unsafeRow.count = 2;
unsafeRow.empty = null;
unsafeRow.__proto__ = 'blocked';
const preview = normalizePreviewPageResult({
  datasetId: 'dataset-1',
  rows: [unsafeRow, { name: 'B' }],
  offset: 30,
  limit: 30,
  totalRows: 40,
}, { datasetId: 'dataset-1' });
assert.deepEqual(preview, {
  datasetId: 'dataset-1',
  rows: [
    { name: 'A', count: '2', empty: '' },
    { name: 'B' },
  ],
  offset: 30,
  limit: 30,
  totalRows: 40,
  hasMore: true,
});

const mapView = normalizeMapViewResult({
  points: [
    {
      id: 'point-1',
      lat: '59.3',
      lon: 18.1,
      sourceRef: { datasetId: 'dataset-1', rowIndex: '0' },
      marker: 'blue',
      row: { secret: 'must not be embedded' },
      databaseHandle: rawSecret,
    },
    {
      id: 'group-1',
      renderType: 'grouped',
      lat: 60,
      lon: 19,
      count: '20',
      groupId: 'grid:1:2',
      groupRef: {
        groupId: 'grid:1:2',
        bounds: { north: 70, south: 50, east: 30, west: 10 },
        timeline: null,
        grid: { cellLat: 1, cellLon: 2, cellHeight: 1, cellWidth: 1 },
        sortOrder: 'dataset-source-row',
      },
    },
    { id: 'invalid', lat: 1000, lon: 0 },
  ],
  lines: [{
    id: 'line-1',
    featureId: 'route',
    coordinates: [[1, 2], [3, 4]],
    style: { color: '#123456', weight: 4, sql: 'SELECT secret' },
    arrow: 'invalid',
    sourceRef: { datasetId: 'dataset-1', rowIndex: 2 },
  }],
  regions: [{
    id: 'region-1',
    featureId: 'area',
    part: 'north',
    coordinates: [[5, 5], [6, 6], [5, 7]],
    style: { fillColor: '#abcdef' },
  }],
  stats: {
    returnedCount: 4,
    totalMatchingCount: 10,
    skippedPointsByTimeline: 1,
    skippedLinesByTimeline: 2,
    skippedRegionsByTimeline: 3,
  },
  timelineIndex: {
    entries: [
      { featureId: 'point-1', startYear: 2025, endYear: 1000 },
      { featureId: '', startYear: 1, endYear: 2 },
    ],
  },
});
assert.deepEqual(
  [mapView.points.length, mapView.lines.length, mapView.regions.length],
  [2, 1, 1],
);
assert.equal(Object.hasOwn(mapView.points[0], 'row'), false);
assert.equal(Object.hasOwn(mapView.points[0], 'databaseHandle'), false);
assert.deepEqual(mapView.points[0].sourceRef, {
  datasetId: 'dataset-1',
  rowIndex: 0,
});
assert.equal(mapView.points[1].groupRef.groupId, 'grid:1:2');
assert.equal(Object.hasOwn(mapView.lines[0].style, 'sql'), false);
assert.equal(mapView.lines[0].arrow, 'none');
assert.deepEqual(
  mapView.regions[0].coordinates.at(-1),
  mapView.regions[0].coordinates[0],
);
assert.equal(mapView.stats.hiddenByRenderBudget, 6);
assert.equal(mapView.stats.skippedByTimeline, 6);
assert.deepEqual(mapView.timelineIndex.entries, [{
  featureId: 'point-1',
  startYear: 1000,
  endYear: 2025,
}]);

const details = normalizeFeatureDetailsResult({
  featureId: 'point-1',
  row: { name: 'A', value: 4 },
  latField: 'lat',
  lonField: 'lon',
});
assert.deepEqual(details.row, { name: 'A', value: '4' });

const groupRows = normalizeGroupRowsResult({
  rows: [{ name: 'A' }, null, { name: 'B' }],
  offset: 0,
  limit: 1,
  totalRows: 2,
});
assert.deepEqual(groupRows, {
  rows: [{ name: 'A' }],
  offset: 0,
  limit: 1,
  totalRows: 2,
  hasMore: true,
});

console.log('DataSource normalization smoke test passed.');
