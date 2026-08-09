import assert from 'node:assert/strict';
import Papa from 'papaparse';
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
  removeBrowserSqliteDataset,
} from './browserSqliteDatasetRemoval.js';
import {
  getBrowserSqliteDatasetSummary,
} from './browserSqliteDatasetQueries.js';
import { exportBrowserSqliteDatasetCsv } from './browserSqliteDatasetExport.js';
import {
  getBrowserSqliteFeatureDetails,
} from './browserSqlitePointDetails.js';
import {
  queryBrowserSqliteMapView,
} from './browserSqlitePointQueries.js';
import {
  getBrowserSqliteLogicalZone,
  updateBrowserSqliteLogicalZone,
} from './browserSqliteZoneAdjustments.js';

const HEADERS = [
  'name',
  'featureType',
  'featureId',
  'part',
  'order',
  'lat',
  'lon',
  'altLat',
  'altLon',
  'year',
  'date',
  'dateFrom',
  'dateTo',
  'color',
  'weight',
  'opacity',
  'fillColor',
  'fillOpacity',
  'arrow',
];

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);

try {
  const rows = [
    geometry('Route metadata', 'line', 'route', 0, 10, {
      order: '2', color: '#123456', weight: '25', arrow: 'end', year: '2002',
    }),
    geometry('Route detail', 'line', 'route', 0, -10, {
      order: '1', weight: '1.6', arrow: 'both', year: '2001',
    }),
    geometry('Fallback first', 'line', 'fallback', 5, 5, {
      color: 'worker-color-token', arrow: 'invalid',
    }),
    geometry('Fallback second', 'line', 'fallback', 6, 6, {
      arrow: 'end',
    }),
    geometry('Start first', 'line', 'arrow-start', 20, 20, { arrow: 'start' }),
    geometry('Start second', 'line', 'arrow-start', 21, 21),
    geometry('End first', 'line', 'arrow-end', 22, 22, { arrow: 'end' }),
    geometry('End second', 'line', 'arrow-end', 23, 23),
    geometry('None first', 'line', 'arrow-none', 24, 24, { arrow: 'none' }),
    geometry('None second', 'line', 'arrow-none', 25, 25),
    geometry('Heavy first', 'line', 'heavy', 26, 26, { weight: '25' }),
    geometry('Heavy second', 'line', 'heavy', 27, 27),
    geometry('Light first', 'line', 'light', 28, 28, { weight: '0' }),
    geometry('Light second', 'line', 'light', 29, 29),
    geometry('Too short', 'line', 'short-line', 30, 30),
    geometry('Missing line ID', 'line', '', 31, 31),
    geometry('Invalid line coordinate', 'line', 'invalid-line', 999, 31),
    geometry('Area source', 'region', 'area', 2, 2, {
      part: 'south', order: '2', fillColor: '#abcdef', year: '2001',
    }),
    geometry('Area south first', 'region', 'area', 1, 1, {
      part: 'south', order: '1', year: '2020',
    }),
    geometry('Area south third', 'region', 'area', 1, 3, {
      part: 'south', order: '3',
    }),
    geometry('Area north first', 'region', 'area', 10, 10, {
      part: 'north', order: '1', color: '#fedcba',
    }),
    geometry('Area north second', 'region', 'area', 11, 10, {
      part: 'north', order: '2',
    }),
    geometry('Area north third', 'region', 'area', 10, 11, {
      part: 'north', order: '3',
    }),
    geometry('Cross left', 'region', 'crossing', -5, -5, {
      order: '1', year: '2001',
    }),
    geometry('Cross right', 'region', 'crossing', -5, 5, { order: '2' }),
    geometry('Cross top', 'region', 'crossing', 5, 0, { order: '3' }),
    geometry('Default part first', 'region', 'default-part', 40, 40),
    geometry('Default part second', 'region', 'default-part', 41, 40),
    geometry('Default part third', 'region', 'default-part', 40, 41),
    geometry('Short region one', 'region', 'short-region', 42, 42),
    geometry('Short region two', 'region', 'short-region', 43, 42),
    geometry('Missing region ID', 'region', '', 44, 44),
    geometry('Invalid region coordinate', 'region', 'invalid-region', -999, 44),
    geometry('Mixed point', 'point', '', 50, 50, { year: '1999' }),
  ];

  const imported = importDataset(database, 'dataset-a', rows);
  assert.equal(imported.pointFeatureCount, 1);
  assert.equal(imported.lineFeatureCount, 7);
  assert.equal(imported.regionFeatureCount, 4);
  assert.equal(imported.skippedLineCount, 2);
  assert.equal(imported.skippedRegionCount, 2);
  assert.equal(readCount(database, 'geometry_features', 'dataset-a'), 11);

  importDataset(database, 'dataset-b', [
    geometry('Duplicate first', 'line', 'route', 50, 50, { order: '1' }),
    geometry('Duplicate second', 'line', 'route', 51, 51, { order: '2' }),
  ]);

  const all = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    renderBudget: 100,
  });
  assert.equal(all.lines.length, 8);
  assert.equal(all.regions.length, 4);
  assert.equal(all.points.length, 1);
  assert.equal(all.stats.skippedLines, 2);
  assert.equal(all.stats.skippedRegions, 2);
  assert.equal(all.stats.totalMatchingLineCount, 8);
  assert.equal(all.stats.totalMatchingRegionCount, 4);
  assert.equal(JSON.stringify(all).includes('Route detail'), false);
  assert.equal(JSON.stringify(all).includes('row_json'), false);

  const route = all.lines.find((line) => line.id === 'dataset-a:route');
  assert.deepEqual(route.coordinates, [[0, -10], [0, 10]]);
  assert.deepEqual(route.style, { color: '#123456', weight: 2 });
  assert.equal(route.arrow, 'both');
  assert.deepEqual(route.sourceRef, { datasetId: 'dataset-a', rowIndex: 1 });
  assert.notEqual(
    route.id,
    all.lines.find((line) => line.id === 'dataset-b:route').id,
  );

  const fallback = all.lines.find((line) => line.featureId === 'fallback');
  assert.deepEqual(fallback.coordinates, [[5, 5], [6, 6]]);
  assert.equal(fallback.style.color, 'worker-color-token');
  assert.equal(fallback.arrow, 'end');
  assert.equal(all.lines.find((line) => line.featureId === 'heavy').style.weight, 20);
  assert.equal(all.lines.find((line) => line.featureId === 'light').style.weight, 1);
  assert.equal(all.lines.find((line) => line.featureId === 'arrow-start').arrow, 'start');
  assert.equal(all.lines.find((line) => line.featureId === 'arrow-end').arrow, 'end');
  assert.equal(all.lines.find((line) => line.featureId === 'arrow-none').arrow, 'none');

  const south = all.regions.find((region) => region.part === 'south');
  const north = all.regions.find((region) => region.part === 'north');
  assert.deepEqual(south.coordinates[0], [1, 1]);
  assert.deepEqual(south.coordinates.at(-1), south.coordinates[0]);
  assert.equal(south.style.fillColor, '#abcdef');
  assert.equal(south.style.color, '#abcdef');
  assert.equal(north.style.color, '#fedcba');
  assert.equal(north.style.fillColor, '#fedcba');
  assert.deepEqual(south.sourceRef, { datasetId: 'dataset-a', rowIndex: 17 });
  assert.deepEqual(north.sourceRef, south.sourceRef);
  assert.equal(
    all.regions.find((region) => region.featureId === 'default-part').part,
    '0',
  );

  const crossing = queryBrowserSqliteMapView(database, {
    bounds: { north: 0.5, south: -0.5, east: 0.5, west: -0.5 },
    renderBudget: 100,
  });
  assert.deepEqual(crossing.lines.map((line) => line.featureId), ['route']);
  assert.deepEqual(crossing.regions.map((region) => region.featureId), ['crossing']);

  const timeline = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    timeline: { timelineEnabled: true, startYear: 2001, endYear: 2001 },
    renderBudget: 100,
  });
  assert.deepEqual(timeline.lines.map((line) => line.featureId), ['route']);
  assert.deepEqual(
    timeline.regions.map((region) => `${region.featureId}:${region.part}`),
    ['area:south', 'area:north', 'crossing:0'],
  );
  assert.equal(timeline.stats.skippedLinesByTimeline, 7);
  assert.equal(timeline.stats.skippedRegionsByTimeline, 1);

  const details = getBrowserSqliteFeatureDetails(database, {
    featureId: north.id,
    sourceRef: north.sourceRef,
  });
  assert.equal(details.featureId, north.id);
  assert.equal(details.row.name, 'Area source');
  assert.equal(details.latField, 'lat');
  assert.equal(details.lonField, 'lon');
  assert.deepEqual(
    getBrowserSqliteFeatureDetails(database, {
      sourceRef: { datasetId: 'dataset-a', rowIndex: 14 },
    }),
    { featureId: null, row: null, latField: null, lonField: null },
  );

  const limitedQuery = {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-a'],
    renderBudget: 1,
  };
  const limited = queryBrowserSqliteMapView(database, limitedQuery);
  assert.equal(limited.lines.length + limited.regions.length, 1);
  assert.equal(limited.stats.geometryOverLimit, true);
  assert.equal(limited.stats.geometryLimit, 1);
  assert.equal(limited.stats.totalMatchingLineCount, 7);
  assert.equal(limited.stats.totalMatchingRegionCount, 4);
  assert.equal(limited.stats.hiddenGeometryCount, 10);
  assert.deepEqual(limited, queryBrowserSqliteMapView(database, limitedQuery));

  setBrowserSqliteDatasetEnabled(database, 'dataset-b', false);
  assert.equal(queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    renderBudget: 100,
  }).lines.length, 7);
  setBrowserSqliteDatasetEnabled(database, 'dataset-b', true);

  importDataset(database, 'dataset-edge-cases', [
    geometry('Wrap east', 'line', 'wrapped', 0, 179, { order: '1' }),
    geometry('Wrap west', 'line', 'wrapped', 0, -179, { order: '2' }),
    geometry('Closed first', 'region', 'closed', 60, 60, { order: '1' }),
    geometry('Closed second', 'region', 'closed', 61, 60, { order: '2' }),
    geometry('Closed third', 'region', 'closed', 60, 61, { order: '3' }),
    geometry('Closed repeat', 'region', 'closed', 60, 60, { order: '4' }),
  ]);
  const wrapped = queryBrowserSqliteMapView(database, {
    bounds: { north: 1, south: -1, east: -170, west: 170 },
    datasetIds: ['dataset-edge-cases'],
    renderBudget: 10,
  });
  assert.deepEqual(wrapped.lines.map((line) => line.featureId), ['wrapped']);
  const alreadyClosed = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-edge-cases'],
    renderBudget: 10,
  }).regions[0];
  assert.equal(alreadyClosed.coordinates.length, 4);
  assert.deepEqual(alreadyClosed.coordinates.at(-1), alreadyClosed.coordinates[0]);
  assert.equal(removeBrowserSqliteDataset(
    database,
    'dataset-edge-cases',
  ).ok, true);
  assert.equal(readCount(
    database,
    'geometry_features',
    'dataset-edge-cases',
  ), 0);

  importDataset(database, 'dataset-coverage-a', [
    geometry('Dated line first', 'line', 'dated-line', 70, 70, {
      date: '2005-06-01',
    }),
    geometry('Dated line second', 'line', 'dated-line', 71, 71),
    geometry('Dated line third', 'line', 'dated-line', 72, 72),
    geometry('Invalid arrow first', 'line', 'invalid-arrow', 65, 65, {
      arrow: 'sideways',
    }),
    geometry('Invalid arrow second', 'line', 'invalid-arrow', 66, 66),
    geometry('Fallback region first', 'region', 'same-region', 55, 55),
    geometry('Fallback region second', 'region', 'same-region', 56, 55),
    geometry('Fallback region third', 'region', 'same-region', 55, 56),
    geometry('Range region first', 'region', 'range-region', 45, 45, {
      dateFrom: '2000-01-01', dateTo: '2002-12-31',
    }),
    geometry('Range region second', 'region', 'range-region', 46, 45),
    geometry('Range region third', 'region', 'range-region', 45, 46),
    geometry('Undated region first', 'region', 'undated-region', 35, 35),
    geometry('Undated region second', 'region', 'undated-region', 36, 35),
    geometry('Undated region third', 'region', 'undated-region', 35, 36),
  ], {
    yearField: null,
    dateField: 'date',
    dateFromField: 'dateFrom',
    dateToField: 'dateTo',
  });
  importDataset(database, 'dataset-coverage-b', [
    geometry('Duplicate region first', 'region', 'same-region', 50, 50),
    geometry('Duplicate region second', 'region', 'same-region', 51, 50),
    geometry('Duplicate region third', 'region', 'same-region', 50, 51),
  ]);

  const coverage = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-coverage-a', 'dataset-coverage-b'],
    renderBudget: 100,
  });
  const datedLine = coverage.lines.find(
    (line) => line.featureId === 'dated-line',
  );
  const invalidArrow = coverage.lines.find(
    (line) => line.featureId === 'invalid-arrow',
  );
  const fallbackRegion = coverage.regions.find(
    (region) => region.id.startsWith('dataset-coverage-a:'),
  );
  const duplicateRegion = coverage.regions.find(
    (region) => region.id.startsWith('dataset-coverage-b:'),
  );
  assert.equal(datedLine.coordinates.length, 3);
  assert.deepEqual(datedLine.style, { color: '#3388ff', weight: 3 });
  assert.equal(invalidArrow.arrow, 'none');
  assert.deepEqual(fallbackRegion.coordinates.slice(0, 3), [
    [55, 55],
    [56, 55],
    [55, 56],
  ]);
  assert.deepEqual(fallbackRegion.style, {
    color: '#3388ff',
    weight: 2,
    opacity: 1,
    fillColor: '#3388ff',
    fillOpacity: 0.25,
  });
  assert.equal(fallbackRegion.featureId, duplicateRegion.featureId);
  assert.notEqual(fallbackRegion.id, duplicateRegion.id);

  const insideGeometry = queryBrowserSqliteMapView(database, {
    bounds: { north: 57, south: 54, east: 57, west: 54 },
    datasetIds: ['dataset-coverage-a'],
    renderBudget: 100,
  });
  assert.deepEqual(
    insideGeometry.regions.map((region) => region.featureId),
    ['same-region'],
  );

  const emptyGeometry = queryBrowserSqliteMapView(database, {
    bounds: { north: -70, south: -80, east: -10, west: -20 },
    datasetIds: ['dataset-coverage-a', 'dataset-coverage-b'],
    renderBudget: 100,
  });
  assert.deepEqual([emptyGeometry.lines.length, emptyGeometry.regions.length], [0, 0]);

  const rangeTimeline = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-coverage-a'],
    timeline: { timelineEnabled: true, startYear: 2002, endYear: 2002 },
    renderBudget: 100,
  });
  assert.deepEqual(
    rangeTimeline.regions.map((region) => region.featureId),
    ['range-region'],
  );
  const dateTimeline = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-coverage-a'],
    timeline: { timelineEnabled: true, startYear: 2005, endYear: 2005 },
    renderBudget: 100,
  });
  assert.deepEqual(dateTimeline.lines.map((line) => line.featureId), ['dated-line']);
  assert.equal(
    coverage.regions.some((region) => region.featureId === 'undated-region'),
    true,
  );
  assert.equal(
    dateTimeline.regions.some((region) => region.featureId === 'undated-region'),
    false,
  );
  removeBrowserSqliteDataset(database, 'dataset-coverage-a');
  removeBrowserSqliteDataset(database, 'dataset-coverage-b');

  const summary = getBrowserSqliteDatasetSummary(database);
  assert.equal(
    summary.datasets.find((dataset) => dataset.id === 'dataset-a')
      .importedFeatureCount,
    12,
  );
  assert.deepEqual(summary.timeline, { yearMin: 1999, yearMax: 2001 });

  const remapped = updateBrowserSqliteDatasetMapping(database, 'dataset-a', {
    latField: 'altLat',
    lonField: 'altLon',
  });
  assert.equal(remapped.ok, true);
  const remappedRoute = queryBrowserSqliteMapView(database, {
    bounds: { north: 31, south: 29, east: 31, west: 29 },
    datasetIds: ['dataset-a'],
    renderBudget: 100,
  }).lines.find((line) => line.featureId === 'route');
  assert.deepEqual(remappedRoute.coordinates, [[30, 10], [30, 30]]);

  const mappingBeforeFailure = readMapping(database, 'dataset-a');
  const resultBeforeFailure = queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-a'],
    renderBudget: 100,
  });
  database.run(`
    CREATE TRIGGER fail_geometry_rebuild
    BEFORE INSERT ON geometry_features
    WHEN NEW.dataset_id = 'dataset-a'
    BEGIN
      SELECT RAISE(ABORT, 'simulated geometry rebuild failure');
    END
  `);
  assert.throws(
    () => updateBrowserSqliteDatasetMapping(database, 'dataset-a', {
      latField: 'lat',
      lonField: 'lon',
    }),
    (error) => error?.code === 'operation-failed',
  );
  database.run('DROP TRIGGER fail_geometry_rebuild');
  assert.deepEqual(readMapping(database, 'dataset-a'), mappingBeforeFailure);
  assert.deepEqual(queryBrowserSqliteMapView(database, {
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    datasetIds: ['dataset-a'],
    renderBudget: 100,
  }), resultBeforeFailure);
  assert.equal(readScalar(database, 'PRAGMA foreign_key_check'), null);

  importDataset(database, 'dataset-zone-edit', [
    geometry('Main one', 'region', 'editable', 1, 1, { part: 'main', order: '1' }),
    geometry('Main two', 'region', 'editable', 1, 2, { part: 'main', order: '2' }),
    geometry('Main three', 'region', 'editable', 2, 1, { part: 'main', order: '3' }),
    geometry('Island one', 'region', 'editable', 5, 5, { part: 'island', order: '1' }),
    geometry('Island two', 'region', 'editable', 5, 6, { part: 'island', order: '2' }),
    geometry('Island three', 'region', 'editable', 6, 5, { part: 'island', order: '3' }),
  ]);
  const editableZone = getBrowserSqliteLogicalZone(database, {
    datasetId: 'dataset-zone-edit',
    featureId: 'editable',
  });
  assert.deepEqual(editableZone.parts.map((part) => part.part), ['main', 'island']);
  const movedParts = editableZone.parts.map((part) => ({
    part: part.part,
    coordinates: part.coordinates.map(([lat, lon]) => [lat + 1, lon + 2]),
  }));
  const updatedZone = updateBrowserSqliteLogicalZone(database, {
    datasetId: 'dataset-zone-edit',
    featureId: 'editable',
    parts: movedParts,
  });
  assert.deepEqual(updatedZone.parts[0].coordinates, movedParts[0].coordinates);
  assert.equal(JSON.parse(readScalar(database, `
    SELECT row_json FROM source_rows
    WHERE dataset_id = 'dataset-zone-edit' AND source_row_index = 0
  `)).lat, '2');
  assert.equal(JSON.parse(readScalar(database, `
    SELECT row_json FROM source_rows
    WHERE dataset_id = 'dataset-zone-edit' AND source_row_index = 0
  `)).lon, '3');
  const exportedZoneRows = Papa.parse(
    exportBrowserSqliteDatasetCsv(database, 'dataset-zone-edit').csvText,
    { header: true, skipEmptyLines: true },
  ).data;
  assert.equal(exportedZoneRows[0].lat, '2');
  assert.equal(exportedZoneRows[0].lon, '3');

  const committedZone = structuredClone(updatedZone);
  database.run(`
    CREATE TRIGGER fail_zone_update BEFORE UPDATE ON geometry_features
    WHEN OLD.dataset_id = 'dataset-zone-edit'
    BEGIN SELECT RAISE(ABORT, 'forced zone failure'); END;
  `);
  assert.throws(() => updateBrowserSqliteLogicalZone(database, {
    datasetId: 'dataset-zone-edit',
    featureId: 'editable',
    parts: movedParts.map((part) => ({
      ...part,
      coordinates: part.coordinates.map(([lat, lon]) => [lat + 1, lon + 1]),
    })),
  }));
  database.run('DROP TRIGGER fail_zone_update');
  assert.deepEqual(getBrowserSqliteLogicalZone(database, {
    datasetId: 'dataset-zone-edit',
    featureId: 'editable',
  }), committedZone);
} finally {
  closeBrowserSqliteDatabase(database);
}

console.log('Browser SQLite line and region parity smoke test passed.');

function geometry(name, featureType, featureId, lat, lon, overrides = {}) {
  return {
    name,
    featureType,
    featureId,
    part: '',
    order: '',
    lat: String(lat),
    lon: String(lon),
    altLat: String(Number(lat) + 30),
    altLon: String(Number(lon) + 20),
    year: '',
    date: '',
    dateFrom: '',
    dateTo: '',
    color: '',
    weight: '',
    opacity: '',
    fillColor: '',
    fillOpacity: '',
    arrow: '',
    ...overrides,
  };
}

function importDataset(targetDatabase, datasetId, rows, fieldOverrides = {}) {
  const activeImport = beginBrowserSqliteFileImport(targetDatabase, {
    datasetId,
    fileName: `${datasetId}.csv`,
  });
  insertBrowserSqliteImportRowBatch(activeImport, rows);
  return completeBrowserSqliteFileImport(activeImport, {
    headers: HEADERS,
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
    importedAt: datasetId === 'dataset-a'
      ? '2026-07-26T18:00:00.000Z'
      : '2026-07-26T18:00:01.000Z',
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
