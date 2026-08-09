'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const ELECTRON_SMOKE_CHILD = 'CSV_MAP_SQLITE_DETAIL_SMOKE_CHILD';
const DATASET_A = 'detail-smoke-a';
const DATASET_B = 'detail-smoke-b';

function runSmokeCheck() {
  const { closeSqliteStore } = require('./sqliteStore.cjs');
  // Keep this smoke check isolated while using the same schema as the app.
  const db = createSmokeDatabase();

  try {
    runExactDetailSmoke(db);
    runGroupedPagingSmoke(db);
    console.log('SQLite detail smoke: exact details and grouped paging passed.');
  } finally {
    closeSqliteStore(db);
  }
}

function runExactDetailSmoke(db) {
  const { getSqliteFeatureDetails } = require('./sqliteDetailQuery.cjs');
  // The stable source reference should find the row across dataset boundaries.
  const result = getSqliteFeatureDetails({
    db,
    sourceRef: {
      datasetId: DATASET_B,
      rowIndex: 0,
    },
  });

  assert.deepEqual(result, {
    featureId: 'detail-b-0',
    row: {
      name: 'match-three',
      latitude: '1',
      longitude: '1',
    },
    latField: 'latitude',
    lonField: 'longitude',
  });
  assert.deepEqual(
    getSqliteFeatureDetails({
      db,
      sourceRef: {
        datasetId: DATASET_B,
        rowIndex: 999,
      },
    }),
    {
      featureId: null,
      row: null,
      latField: null,
      lonField: null,
    },
  );
  assert.deepEqual(
    getSqliteFeatureDetails({
      db,
      sourceRef: {
        datasetId: DATASET_B,
      },
    }),
    {
      featureId: null,
      row: null,
      latField: null,
      lonField: null,
    },
  );

  console.log('SQLite detail smoke: stable exact lookup passed.');
}

function runGroupedPagingSmoke(db) {
  const {
    DEFAULT_GROUP_ROWS_LIMIT,
    getSqliteGroupRows,
  } = require('./sqliteDetailQuery.cjs');
  // The fixture includes other dates, cells, and a region vertex to prove the saved group filter.
  const groupRef = {
    groupId: 'grid:18:36',
    bounds: {
      north: 10,
      south: 0,
      east: 10,
      west: 0,
    },
    timeline: {
      timelineEnabled: true,
      startYear: 2000,
      endYear: 2005,
    },
    grid: {
      cellLat: 18,
      cellLon: 36,
      cellHeight: 5,
      cellWidth: 5,
    },
    sortOrder: 'dataset-source-row',
  };
  // Two pages also verify the fixed dataset and source-row ordering.
  const firstPage = getSqliteGroupRows({
    db,
    groupRef,
    offset: 0,
    limit: 2,
  });
  const secondPage = getSqliteGroupRows({
    db,
    groupRef,
    offset: 2,
    limit: 2,
  });

  assert.deepEqual(firstPage, {
    rows: [
      {
        name: 'match-one',
        latitude: '1',
        longitude: '1',
      },
      {
        name: 'match-two',
        latitude: '1',
        longitude: '1',
      },
    ],
    offset: 0,
    limit: 2,
    totalRows: 3,
  });
  assert.deepEqual(secondPage, {
    rows: [
      {
        name: 'match-three',
        latitude: '1',
        longitude: '1',
      },
    ],
    offset: 2,
    limit: 2,
    totalRows: 3,
  });

  const { setSqliteDatasetEnabled } = require('./sqliteDatasetService.cjs');
  setSqliteDatasetEnabled({ db, datasetId: DATASET_B, enabled: false });
  assert.deepEqual(getSqliteGroupRows({
    db,
    groupRef,
    offset: 0,
    limit: 10,
  }), {
    rows: [
      {
        name: 'match-one',
        latitude: '1',
        longitude: '1',
      },
      {
        name: 'match-two',
        latitude: '1',
        longitude: '1',
      },
    ],
    offset: 0,
    limit: 10,
    totalRows: 2,
  });
  setSqliteDatasetEnabled({ db, datasetId: DATASET_B, enabled: true });
  assert.deepEqual(
    getSqliteGroupRows({
      db,
      groupRef: {
        ...groupRef,
        groupId: 'grid:wrong',
      },
      offset: -1,
      limit: 0,
    }),
    {
      rows: [],
      offset: 0,
      limit: DEFAULT_GROUP_ROWS_LIMIT,
      totalRows: 0,
    },
  );

  console.log('SQLite detail smoke: deterministic timeline-aware paging passed.');
}

function createSmokeDatabase() {
  const Database = require('better-sqlite3');
  const { closeSqliteStore, initializeSchema } = require('./sqliteStore.cjs');
  const db = new Database(':memory:');
  const features = [
    createFeature(DATASET_A, 0, 'excluded-before', 1, 1, 1980, 1990),
    createFeature(DATASET_A, 1, 'match-one', 1, 1, 1995, 2001),
    createFeature(DATASET_A, 2, 'match-two', 1, 1, 2003, 2003),
    createFeature(DATASET_A, 3, 'other-cell', 6, 1, 2003, 2003),
    createFeature(DATASET_A, 4, 'excluded-region-vertex', 1, 1, 2003, 2003, 'region'),
    createFeature(DATASET_B, 0, 'match-three', 1, 1, 2005, 2010),
    createFeature(DATASET_B, 1, 'excluded-after', 1, 1, 2011, 2020),
  ];

  try {
    initializeSchema(db);
    insertDataset(db, DATASET_A, 5);
    insertDataset(db, DATASET_B, 2);

    const insertFeature = db.prepare([
      'INSERT INTO features (',
      '  id, dataset_id, source_row_index, lat, lon,',
      '  timeline_start_year, timeline_end_year, compact_json, row_json',
      ') VALUES (',
      '  @id, @datasetId, @sourceRowIndex, @lat, @lon,',
      '  @timelineStartYear, @timelineEndYear, @compactJson, @rowJson',
      ')',
    ].join('\n'));
    const insertFeatures = db.transaction((rows) => {
      rows.forEach((feature) => insertFeature.run(feature));
    });

    insertFeatures(features);
    return db;
  } catch (error) {
    closeSqliteStore(db);
    throw error;
  }
}

function insertDataset(db, datasetId, rowCount) {
  db.prepare([
    'INSERT INTO datasets (',
    '  id, file_name, source_path, row_count, imported_feature_count,',
    '  skipped_row_count, columns_json, imported_at',
    ') VALUES (',
    '  @id, @fileName, NULL, @rowCount, @rowCount,',
    '  0, @columnsJson, @importedAt',
    ')',
  ].join('\n')).run({
    id: datasetId,
    fileName: datasetId + '.csv',
    rowCount,
    columnsJson: JSON.stringify(['name', 'latitude', 'longitude']),
    importedAt: '2026-01-01T00:00:00.000Z',
  });
}

function createFeature(
  datasetId,
  sourceRowIndex,
  name,
  lat,
  lon,
  timelineStartYear,
  timelineEndYear,
  featureType = null,
) {
  return {
    id: datasetId === DATASET_A
      ? 'detail-a-' + sourceRowIndex
      : 'detail-b-' + sourceRowIndex,
    datasetId,
    sourceRowIndex,
    lat,
    lon,
    timelineStartYear,
    timelineEndYear,
    compactJson: JSON.stringify({
      latField: 'latitude',
      lonField: 'longitude',
      ...(featureType ? { featureType } : {}),
    }),
    rowJson: JSON.stringify({
      name,
      latitude: String(lat),
      longitude: String(lon),
    }),
  };
}

function runInElectronNode() {
  const electronPath = require('electron');
  // Run with Electron's Node ABI because better-sqlite3 is built for Electron.
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      [ELECTRON_SMOKE_CHILD]: '1',
    },
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(
      'Electron detail smoke process stopped by signal ' + result.signal + '.',
    );
  }

  process.exitCode = result.status ?? 1;
}

function main() {
  try {
    if (process.env[ELECTRON_SMOKE_CHILD] !== '1') {
      runInElectronNode();
      return;
    }

    if (!process.versions.electron) {
      throw new Error(
        'SQLite detail smoke check did not start in Electron Node mode.',
      );
    }

    runSmokeCheck();
  } catch (error) {
    console.error('SQLite detail smoke check failed.', error);
    process.exitCode = 1;
  }
}

main();
