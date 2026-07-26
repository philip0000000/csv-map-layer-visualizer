import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
} from './browserSqliteDatabase.js';
import {
  beginBrowserSqliteFileImport,
  completeBrowserSqliteFileImport,
  insertBrowserSqliteImportRowBatch,
} from './browserSqliteImportTransaction.js';
import {
  setBrowserSqliteDatasetEnabled,
  updateBrowserSqliteDatasetMapping,
} from './browserSqliteDatasetMutations.js';
import {
  getBrowserSqliteDatasetSummary,
} from './browserSqliteDatasetQueries.js';
import {
  getBrowserSqliteGroupRows,
  getBrowserSqlitePointDetails,
} from './browserSqlitePointDetails.js';
import {
  queryBrowserSqliteMapView,
} from './browserSqlitePointQueries.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  const firstRows = [
    point('First', 10, 10, 2000, { marker: 'red', image: 'pin.png' }),
    point('Second', 10, 10, 2001, { featureType: '' }),
    point('Third', 10, 10, 2002),
    point('Line only', 10, 10, 2001, { featureType: 'line' }),
    point('Invalid', 999, 10, 2001),
    point('Undated', 20, 20, ''),
    point('East wrap', 0, 179, 2000),
    point('West wrap', 0, -179, 2000),
  ];
  const firstImport = importDataset(database, 'dataset-a', firstRows);
  assert.equal(firstImport.pointFeatureCount, 6);
  assert.equal(firstImport.skippedPointCount, 1);
  assert.equal(readCount(database, 'source_rows', 'dataset-a'), 8);
  assert.equal(readCount(database, 'point_features', 'dataset-a'), 6);

  importDataset(database, 'dataset-b', [
    point('Dataset B', 11, 11, 2000),
  ]);
  importDataset(database, 'dataset-c', [
    timelinePoint('Single date', { date: '1998-06-01' }),
    timelinePoint('Reversed range', {
      dateFrom: '2002-01-01',
      dateTo: '2000-12-31',
    }),
    timelinePoint('No date', {}),
  ], {
    yearField: null,
    dateField: 'date',
    yearFromField: null,
    yearToField: null,
    dateFromField: 'dateFrom',
    dateToField: 'dateTo',
  });
  const summary = getBrowserSqliteDatasetSummary(database);
  assert.deepEqual(summary.timeline, { yearMin: 1998, yearMax: 2002 });
  assert.equal(
    summary.datasets.find((dataset) => dataset.id === 'dataset-a')
      .importedFeatureCount,
    6,
  );

  const exactQuery = {
    bounds: { north: 30, south: 0, east: 30, west: 0 },
    renderBudget: 10,
  };
  const exact = queryBrowserSqliteMapView(database, exactQuery);
  assert.equal(exact.points.length, 5);
  assert.equal(exact.stats.skippedPoints, 1);
  assert.equal(exact.stats.overBudget, false);
  assert.deepEqual(exact.points[0].sourceRef, {
    datasetId: 'dataset-a',
    rowIndex: 0,
  });
  assert.equal(exact.points[0].image, '/point-images/pin.png');
  assert.equal(exact.points[0].renderType, 'exact');
  assert.equal(JSON.stringify(exact).includes('row_json'), false);
  assert.equal(exact.points.some((item) => Object.hasOwn(item, 'row')), false);

  const timeline = queryBrowserSqliteMapView(database, {
    ...exactQuery,
    timeline: { timelineEnabled: true, startYear: 2001, endYear: 2001 },
  });
  assert.deepEqual(timeline.points.map((item) => item.id), ['dataset-a:1']);
  assert.equal(timeline.stats.skippedPointsByTimeline, 4);

  const dateTimeline = queryBrowserSqliteMapView(database, {
    bounds: { north: 50, south: 30, east: 50, west: 30 },
    datasetIds: ['dataset-c'],
    timeline: { timelineEnabled: true, startYear: 2001, endYear: 2001 },
    renderBudget: 10,
  });
  assert.deepEqual(dateTimeline.points.map((item) => item.id), ['dataset-c:1']);
  assert.equal(dateTimeline.stats.skippedPointsByTimeline, 2);

  const reversedTimeline = queryBrowserSqliteMapView(database, {
    ...exactQuery,
    timeline: { timelineEnabled: true, startYear: 2002, endYear: 2000 },
  });
  assert.equal(reversedTimeline.points.length, 4);

  const wrapped = queryBrowserSqliteMapView(database, {
    bounds: { north: 1, south: -1, east: -170, west: 170 },
    renderBudget: 10,
  });
  assert.deepEqual(
    wrapped.points.map((item) => item.id),
    ['dataset-a:6', 'dataset-a:7'],
  );
  assert.equal(queryBrowserSqliteMapView(database, {
    bounds: { north: -50, south: -60, east: 10, west: 0 },
  }).points.length, 0);

  setBrowserSqliteDatasetEnabled(database, 'dataset-b', false);
  assert.equal(queryBrowserSqliteMapView(database, exactQuery).points.length, 4);
  setBrowserSqliteDatasetEnabled(database, 'dataset-b', true);

  const denseQuery = {
    bounds: { north: 11, south: 9, east: 11, west: 9 },
    renderBudget: 1,
  };
  const dense = queryBrowserSqliteMapView(database, denseQuery);
  assert.equal(dense.stats.totalMatchingCount, 4);
  assert.equal(dense.stats.overBudget, true);
  assert.equal(dense.points.length, 1);
  assert.equal(dense.points[0].count, 4);
  assert.equal(dense.points[0].renderType, 'grouped');
  assert.deepEqual(dense, queryBrowserSqliteMapView(database, denseQuery));
  assert.deepEqual(dense.points[0].groupRef.datasetIds, [
    'dataset-a',
    'dataset-b',
    'dataset-c',
  ]);

  const firstPage = getBrowserSqliteGroupRows(database, {
    groupRef: dense.points[0].groupRef,
    limit: 2,
  });
  const secondPage = getBrowserSqliteGroupRows(database, {
    groupRef: dense.points[0].groupRef,
    offset: 2,
    limit: 2,
  });
  assert.deepEqual(firstPage.rows.map((row) => row.name), ['First', 'Second']);
  assert.deepEqual(secondPage.rows.map((row) => row.name), [
    'Third',
    'Dataset B',
  ]);
  assert.equal(firstPage.totalRows, 4);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.hasMore, false);

  // Visibility is part of the captured dataset snapshot, so a later toggle
  // does not broaden or narrow an already-open group.
  setBrowserSqliteDatasetEnabled(database, 'dataset-b', false);
  assert.equal(getBrowserSqliteGroupRows(database, {
    groupRef: dense.points[0].groupRef,
  }).totalRows, 4);
  setBrowserSqliteDatasetEnabled(database, 'dataset-b', true);

  const details = getBrowserSqlitePointDetails(database, {
    sourceRef: exact.points[0].sourceRef,
  });
  assert.equal(details.featureId, 'dataset-a:0');
  assert.equal(details.row.name, 'First');
  assert.equal(details.latField, 'lat');
  assert.equal(details.lonField, 'lon');
  assert.deepEqual(
    getBrowserSqlitePointDetails(database, {
      sourceRef: { datasetId: 'dataset-a', rowIndex: 999 },
    }),
    { featureId: null, row: null, latField: null, lonField: null },
  );
  assert.equal(
    getBrowserSqliteGroupRows(database, { groupRef: { sql: 'unsafe' } })
      .totalRows,
    0,
  );

  database.run('DELETE FROM datasets WHERE id = ?', ['dataset-b']);
  const afterRemoval = getBrowserSqliteGroupRows(database, {
    groupRef: dense.points[0].groupRef,
  });
  assert.equal(afterRemoval.totalRows, 3);

  const remapped = updateBrowserSqliteDatasetMapping(database, 'dataset-a', {
    latField: 'altLat',
    lonField: 'altLon',
  });
  assert.equal(remapped.ok, true);
  assert.equal(
    queryBrowserSqliteMapView(database, exactQuery).points.length,
    0,
  );
  assert.equal(
    queryBrowserSqliteMapView(database, {
      bounds: { north: 50, south: 30, east: 50, west: 30 },
      renderBudget: 20,
    }).points.length,
    7,
  );

  const mappingBeforeFailure = readMapping(database, 'dataset-a');
  database.run(`
    CREATE TRIGGER fail_point_rebuild
    BEFORE INSERT ON point_features
    WHEN NEW.dataset_id = 'dataset-a'
    BEGIN
      SELECT RAISE(ABORT, 'simulated point rebuild failure');
    END
  `);
  assert.throws(
    () => updateBrowserSqliteDatasetMapping(database, 'dataset-a', {
      latField: 'lat',
      lonField: 'lon',
    }),
    (error) => error?.code === 'operation-failed',
  );
  database.run('DROP TRIGGER fail_point_rebuild');
  assert.deepEqual(readMapping(database, 'dataset-a'), mappingBeforeFailure);
  assert.equal(
    queryBrowserSqliteMapView(database, {
      bounds: { north: 50, south: 30, east: 50, west: 30 },
      renderBudget: 20,
    }).points.length,
    7,
  );

  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);
} finally {
  closeBrowserSqliteDatabase(database);
}

console.log(
  'Browser SQLite point derivation, viewport, detail, and paging smoke test passed.',
);

function point(name, lat, lon, year, overrides = {}) {
  return {
    name,
    featureType: 'point',
    lat: String(lat),
    lon: String(lon),
    altLat: String(Number(lat) + 30),
    altLon: String(Number(lon) + 30),
    year: String(year),
    marker: '',
    image: '',
    imageWidthMeters: '',
    imageHeightMeters: '',
    ...overrides,
  };
}

function timelinePoint(name, overrides) {
  return {
    name,
    featureType: 'point',
    lat: '40',
    lon: '40',
    altLat: '40',
    altLon: '40',
    date: '',
    dateFrom: '',
    dateTo: '',
    marker: '',
    image: '',
    imageWidthMeters: '',
    imageHeightMeters: '',
    ...overrides,
  };
}

function importDataset(targetDatabase, datasetId, rows, fieldOverrides = {}) {
  const headers = Object.keys(rows[0]);
  const activeImport = beginBrowserSqliteFileImport(targetDatabase, {
    datasetId,
    fileName: `${datasetId}.csv`,
  });
  insertBrowserSqliteImportRowBatch(activeImport, rows);
  return completeBrowserSqliteFileImport(activeImport, {
    headers,
    totalParsedRowCount: rows.length,
    skippedRowCount: 0,
    detectedFields: {
      latField: 'lat',
      lonField: 'lon',
      yearField: 'year',
      dateField: null,
      dayOfYearField: null,
      yearFromField: null,
      yearToField: null,
      dateFromField: null,
      dateToField: null,
      ...fieldOverrides,
    },
    coordinateMapping: { latField: 'lat', lonField: 'lon' },
    warnings: [],
    importedAt: `2026-07-26T18:00:0${datasetId === 'dataset-a' ? 0 : 1}.000Z`,
  });
}

function readCount(targetDatabase, table, datasetId) {
  return readScalar(
    targetDatabase,
    `SELECT COUNT(*) FROM ${table} WHERE dataset_id = ?`,
    [datasetId],
  );
}

function readMapping(targetDatabase, datasetId) {
  return JSON.parse(readScalar(
    targetDatabase,
    'SELECT coordinate_mapping_json FROM datasets WHERE id = ?',
    [datasetId],
  ));
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
