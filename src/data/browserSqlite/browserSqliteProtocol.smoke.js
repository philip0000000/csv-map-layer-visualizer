import assert from 'node:assert/strict';
import {
  BROWSER_SQLITE_OPERATIONS,
  BrowserSqliteProtocolError,
  MAX_BROWSER_SQLITE_IMPORT_FILES,
  createBrowserSqliteFailureResponse,
  createBrowserSqliteProgressEvent,
  createBrowserSqliteSuccessResponse,
  createBrowserSqliteUncorrelatedFailureResponse,
  validateBrowserSqliteRequest,
} from './browserSqliteProtocol.js';

class TestBrowserFile {
  constructor(name) {
    this.name = name;
    this.size = 10;
    this.type = 'text/csv';
    this.lastModified = 1_750_000_000_000;
  }

  slice() {
    return new Blob(['name\nrow']);
  }
}

const file = new TestBrowserFile('safe.csv');

assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-initialize',
  operation: BROWSER_SQLITE_OPERATIONS.INITIALIZE,
}), {
  requestId: 'request-initialize',
  operation: 'initialize',
  payload: {},
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-summary',
  operation: BROWSER_SQLITE_OPERATIONS.GET_DATASET_SUMMARY,
  payload: {},
}), {
  requestId: 'request-summary',
  operation: 'get-dataset-summary',
  payload: {},
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-close',
  operation: BROWSER_SQLITE_OPERATIONS.CLOSE,
}), {
  requestId: 'request-close',
  operation: 'close',
  payload: {},
});

const importRequest = validateBrowserSqliteRequest({
  requestId: ' request-import ',
  operation: BROWSER_SQLITE_OPERATIONS.IMPORT_FILES,
  payload: {
    importId: ' import-1 ',
    files: [file],
  },
});
assert.equal(importRequest.requestId, 'request-import');
assert.equal(importRequest.payload.importId, 'import-1');
assert.equal(importRequest.payload.files.length, 1);
assert.equal(importRequest.payload.files[0], file);

assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-cancel',
  operation: BROWSER_SQLITE_OPERATIONS.CANCEL_IMPORT,
  payload: { importId: 'import-1' },
}), {
  requestId: 'request-cancel',
  operation: 'cancel-import',
  payload: { importId: 'import-1' },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-enabled',
  operation: BROWSER_SQLITE_OPERATIONS.SET_DATASET_ENABLED,
  payload: { datasetId: 'dataset-1', enabled: false },
}), {
  requestId: 'request-enabled',
  operation: 'set-dataset-enabled',
  payload: { datasetId: 'dataset-1', enabled: false },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-remove',
  operation: BROWSER_SQLITE_OPERATIONS.REMOVE_DATASET,
  payload: { datasetId: 'dataset-1' },
}), {
  requestId: 'request-remove',
  operation: 'remove-dataset',
  payload: { datasetId: 'dataset-1' },
});
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-export-path',
  operation: BROWSER_SQLITE_OPERATIONS.EXPORT_DATASET_CSV,
  payload: { datasetId: 'dataset-1', path: 'C:\\private\\export.csv' },
}), 'invalid-request');
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-export',
  operation: BROWSER_SQLITE_OPERATIONS.EXPORT_DATASET_CSV,
  payload: { datasetId: 'dataset-1' },
}), {
  requestId: 'request-export',
  operation: 'export-dataset-csv',
  payload: { datasetId: 'dataset-1' },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-mapping',
  operation: BROWSER_SQLITE_OPERATIONS.UPDATE_DATASET_MAPPING,
  payload: {
    datasetId: 'dataset-1',
    mapping: { latField: ' lat ', lonField: '' },
  },
}), {
  requestId: 'request-mapping',
  operation: 'update-dataset-mapping',
  payload: {
    datasetId: 'dataset-1',
    mapping: { latField: 'lat', lonField: null },
  },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-preview',
  operation: BROWSER_SQLITE_OPERATIONS.GET_PREVIEW_PAGE,
  payload: { datasetId: 'dataset-1' },
}), {
  requestId: 'request-preview',
  operation: 'get-preview-page',
  payload: { datasetId: 'dataset-1', offset: 0, limit: 30 },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-preview-page',
  operation: BROWSER_SQLITE_OPERATIONS.GET_PREVIEW_PAGE,
  payload: { datasetId: 'dataset-1', offset: 10, limit: 25 },
}), {
  requestId: 'request-preview-page',
  operation: 'get-preview-page',
  payload: { datasetId: 'dataset-1', offset: 10, limit: 25 },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-map-view',
  operation: BROWSER_SQLITE_OPERATIONS.QUERY_MAP_VIEW,
  payload: {
    bounds: { north: 10, south: -10, east: -170, west: 170 },
    zoom: 5,
    timeline: {
      timelineEnabled: true,
      startYear: 2002,
      endYear: 2000,
    },
    renderBudget: 50,
    datasetIds: ['dataset-2', 'dataset-1', 'dataset-1'],
  },
}), {
  requestId: 'request-map-view',
  operation: 'query-map-view',
  payload: {
    bounds: { north: 10, south: -10, east: -170, west: 170 },
    zoom: 5,
    timeline: {
      timelineEnabled: true,
      startYear: 2002,
      endYear: 2000,
      yearMin: null,
      yearMax: null,
      dayFilterEnabled: false,
      startDay: null,
      endDay: null,
    },
    renderBudget: 50,
    datasetIds: ['dataset-1', 'dataset-2'],
  },
});
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-details',
  operation: BROWSER_SQLITE_OPERATIONS.GET_FEATURE_DETAILS,
  payload: {
    featureId: 'dataset-1:4',
    sourceRef: { datasetId: 'dataset-1', rowIndex: 4 },
  },
}), {
  requestId: 'request-details',
  operation: 'get-feature-details',
  payload: {
    featureId: 'dataset-1:4',
    sourceRef: { datasetId: 'dataset-1', rowIndex: 4 },
  },
});
const groupRef = {
  groupId: 'grid:4:5',
  bounds: { north: 10, south: 0, east: 10, west: 0 },
  datasetIds: ['dataset-1'],
  timeline: null,
  grid: { cellLat: 4, cellLon: 5, cellHeight: 1, cellWidth: 2 },
  sortOrder: 'dataset-source-row',
};
assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-group',
  operation: BROWSER_SQLITE_OPERATIONS.GET_GROUP_ROWS,
  payload: { groupRef, offset: 10, limit: 500 },
}), {
  requestId: 'request-group',
  operation: 'get-group-rows',
  payload: { groupRef, offset: 10, limit: 100 },
});

assert.deepEqual(validateBrowserSqliteRequest({
  requestId: 'request-zone-update',
  operation: BROWSER_SQLITE_OPERATIONS.UPDATE_LOGICAL_ZONE,
  payload: {
    datasetId: 'dataset-1',
    featureId: 'zone',
    parts: [{
      part: 'main',
      coordinates: [[1, 1], [1, 2], [2, 1], [1, 1]],
    }],
  },
}).payload.parts[0].coordinates, [[1, 1], [1, 2], [2, 1], [1, 1]]);
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-zone-invalid',
  operation: BROWSER_SQLITE_OPERATIONS.UPDATE_LOGICAL_ZONE,
  payload: {
    datasetId: 'dataset-1',
    featureId: 'zone',
    parts: [{ part: 'main', coordinates: [[1, 1]] }],
  },
}), 'invalid-request');

assertProtocolError(() => validateBrowserSqliteRequest(null), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest([]), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request',
  operation: 'execute-sql',
  payload: { sql: 'DROP TABLE datasets' },
}), 'unsupported-operation');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: '',
  operation: 'initialize',
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'x'.repeat(257),
  operation: 'initialize',
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  type: 'request',
  requestId: 'request',
  operation: 'initialize',
}), 'invalid-request');

for (const hostilePayload of [
  { sql: 'SELECT * FROM datasets' },
  { database: { exec() {} } },
  { bytes: new Uint8Array([1, 2, 3]) },
  { url: 'https://example.invalid/data.csv' },
  { path: String.raw`C:\private\data.csv` },
  { ipcRenderer: { send() {} } },
  { electron: true },
]) {
  assertProtocolError(() => validateBrowserSqliteRequest({
    requestId: 'request-hostile',
    operation: 'initialize',
    payload: hostilePayload,
  }), 'invalid-request');
}

assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-import-empty',
  operation: 'import-files',
  payload: { importId: 'import-1', files: [] },
}), 'invalid-file-list');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-import-large',
  operation: 'import-files',
  payload: {
    importId: 'import-1',
    files: Array.from(
      { length: MAX_BROWSER_SQLITE_IMPORT_FILES + 1 },
      (_, index) => new TestBrowserFile(`file-${index}.csv`),
    ),
  },
}), 'invalid-file-list');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-import-bytes',
  operation: 'import-files',
  payload: { importId: 'import-1', files: [new Uint8Array([1])] },
}), 'invalid-file-list');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-import-path',
  operation: 'import-files',
  payload: {
    importId: 'import-1',
    files: [new TestBrowserFile(String.raw`C:\private\data.csv`)],
  },
}), 'invalid-file-list');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-import-url',
  operation: 'import-files',
  payload: {
    importId: 'import-1',
    files: [new TestBrowserFile('https://example.invalid/data.csv')],
  },
}), 'invalid-file-list');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-import-extra',
  operation: 'import-files',
  payload: { importId: 'import-1', files: [file], path: 'private.csv' },
}), 'invalid-request');

assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-cancel-invalid',
  operation: 'cancel-import',
  payload: {},
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-enabled-invalid',
  operation: 'set-dataset-enabled',
  payload: { datasetId: 'dataset-1', enabled: 1 },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-mapping-array',
  operation: 'update-dataset-mapping',
  payload: { datasetId: 'dataset-1', mapping: [] },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-mapping-field',
  operation: 'update-dataset-mapping',
  payload: { datasetId: 'dataset-1', mapping: { latField: 42 } },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-mapping-sql',
  operation: 'update-dataset-mapping',
  payload: {
    datasetId: 'dataset-1',
    mapping: { latField: 'lat', sql: 'DELETE FROM datasets' },
  },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-preview-offset',
  operation: 'get-preview-page',
  payload: { datasetId: 'dataset-1', offset: -1 },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-preview-fraction',
  operation: 'get-preview-page',
  payload: { datasetId: 'dataset-1', offset: 1.5 },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-preview-limit',
  operation: 'get-preview-page',
  payload: { datasetId: 'dataset-1', limit: 0 },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-map-sql',
  operation: 'query-map-view',
  payload: { sql: 'SELECT row_json FROM source_rows' },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-map-bounds',
  operation: 'query-map-view',
  payload: { bounds: { north: 1, south: 0, east: 1, west: Infinity } },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-group-id',
  operation: 'get-group-rows',
  payload: { groupRef: { ...groupRef, groupId: 'grid:unsafe' } },
}), 'invalid-request');
assertProtocolError(() => validateBrowserSqliteRequest({
  requestId: 'request-group-datasets',
  operation: 'get-group-rows',
  payload: { groupRef: { ...groupRef, datasetIds: [] } },
}), 'invalid-request');

assert.deepEqual(createBrowserSqliteSuccessResponse('request-1', {
  datasets: [{ id: 'dataset-1', name: 'safe.csv' }],
}), {
  type: 'response',
  requestId: 'request-1',
  ok: true,
  result: {
    datasets: [{ id: 'dataset-1', name: 'safe.csv' }],
  },
});
assert.deepEqual(
  createBrowserSqliteFailureResponse('request-2', 'dataset-not-found'),
  {
    type: 'response',
    requestId: 'request-2',
    ok: false,
    error: {
      code: 'dataset-not-found',
      message: 'The requested dataset is unavailable.',
    },
  },
);
assert.deepEqual(createBrowserSqliteUncorrelatedFailureResponse(
  'invalid-request',
), {
  type: 'response',
  requestId: null,
  ok: false,
  error: {
    code: 'invalid-request',
    message: 'The worker request is invalid.',
  },
});
assert.deepEqual(
  createBrowserSqliteFailureResponse('request-3', 'raw-sql-failure'),
  {
    type: 'response',
    requestId: 'request-3',
    ok: false,
    error: {
      code: 'operation-failed',
      message: 'The temporary database operation failed.',
    },
  },
);
assertProtocolError(() => createBrowserSqliteSuccessResponse('request', {
  database: { close() {} },
}), 'invalid-response');
assertProtocolError(() => createBrowserSqliteSuccessResponse(
  'request',
  new Uint8Array([1, 2, 3]),
), 'invalid-response');
const circular = {};
circular.self = circular;
assertProtocolError(() => createBrowserSqliteSuccessResponse(
  'request',
  circular,
), 'invalid-response');

assert.deepEqual(createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'storing',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 2,
  completedRows: 50,
  totalRows: null,
}), {
  type: 'progress',
  importId: 'import-1',
  state: 'storing',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 2,
  completedRows: 50,
  totalRows: null,
  ok: null,
});
assert.deepEqual(createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'completed',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 2,
  completedRows: 75,
  totalRows: 75,
  ok: true,
}), {
  type: 'progress',
  importId: 'import-1',
  state: 'completed',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 2,
  completedRows: 75,
  totalRows: 75,
  ok: true,
});
assertProtocolError(() => createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'unknown',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 1,
}), 'invalid-progress');
assertProtocolError(() => createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'completed',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 1,
}), 'invalid-progress');
assertProtocolError(() => createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'parsing',
  fileName: 'safe.csv',
  fileNumber: 2,
  totalFiles: 1,
}), 'invalid-progress');
assertProtocolError(() => createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'parsing',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 1,
  completedRows: 11,
  totalRows: 10,
}), 'invalid-progress');
assertProtocolError(() => createBrowserSqliteProgressEvent({
  importId: 'import-1',
  state: 'parsing',
  fileName: 'safe.csv',
  fileNumber: 1,
  totalFiles: 1,
  rows: [{ private: 'source row' }],
}), 'invalid-progress');

assert.deepEqual(
  new Set(Object.values(BROWSER_SQLITE_OPERATIONS)),
  new Set([
    'initialize',
    'import-files',
    'cancel-import',
    'get-dataset-summary',
    'set-dataset-enabled',
    'remove-dataset',
    'export-dataset-csv',
    'update-dataset-mapping',
    'get-preview-page',
    'query-map-view',
    'get-feature-details',
    'get-group-rows',
    'get-logical-zone',
    'update-logical-zone',
    'close',
  ]),
);

console.log('Browser SQLite worker protocol validation smoke test passed.');

function assertProtocolError(callback, code) {
  assert.throws(callback, (error) => (
    error instanceof BrowserSqliteProtocolError &&
    error.code === code &&
    !String(error.message).includes('DROP TABLE') &&
    !String(error.message).includes('DELETE FROM') &&
    !String(error.message).includes('C:\\private') &&
    !String(error.message).includes('https://')
  ));
}
