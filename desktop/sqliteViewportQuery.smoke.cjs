"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const ELECTRON_SMOKE_CHILD = "CSV_MAP_SQLITE_VIEWPORT_SMOKE_CHILD";
const SMOKE_DATASET_ID = "sqlite-viewport-smoke";
const SECOND_DATASET_ID = "sqlite-viewport-smoke-second";
const ROW_JSON_SENTINEL = "sqlite-viewport-smoke-full-row";

/**
 * Run the repeatable SQLite viewport smoke checks.
 */
function runSmokeCheck() {
  // Keep scenarios isolated so one fixture cannot hide a query regression in another.
  runUnderBudgetExactSmoke();
  runWrappedWorldViewportSmoke();
  runOverBudgetGroupingSmoke();
  runCompleteGridCoverageSmoke();
  runTimelineBeforeGroupingSmoke();
  runDatasetVisibilitySmoke();
  console.log("SQLite viewport smoke: compact render results passed.");
}

/** Prove very wide, panned Leaflet bounds always query the complete world. */
function runWrappedWorldViewportSmoke() {
  const { closeSqliteStore } = require("./sqliteStore.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  const db = createSmokeDatabase([
    { id: "western-point", lat: 0, lon: -170 },
    { id: "central-point", lat: 0, lon: 0 },
    { id: "eastern-point", lat: 0, lon: 170 },
  ]);

  try {
    for (const bounds of [
      { north: 90, south: -90, east: 540, west: -540 },
      { north: 90, south: -90, east: 500, west: 100 },
    ]) {
      const result = querySqliteMapView({ db, bounds, renderBudget: 10 });
      assert.equal(result.stats.totalMatchingCount, 3);
      assert.deepEqual(
        result.points.map((point) => point.lon).sort((a, b) => a - b),
        [-170, 0, 170],
      );
    }
    console.log("SQLite viewport smoke: wrapped full-world bounds passed.");
  } finally {
    closeSqliteStore(db);
  }
}

/** Prove occupied cells are merged to fit rather than truncated after grouping. */
function runCompleteGridCoverageSmoke() {
  const { closeSqliteStore } = require("./sqliteStore.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  const db = createSmokeDatabase([
    { id: "north-west", lat: 9, lon: 1 },
    { id: "north-east", lat: 9, lon: 9 },
    { id: "south-west", lat: 1, lon: 1 },
    { id: "south-east", lat: 1, lon: 9 },
  ]);

  try {
    const result = querySqliteMapView({
      db,
      bounds: { north: 10, south: 0, east: 10, west: 0 },
      renderBudget: 3,
    });
    assert.equal(result.points.length <= 3, true);
    assert.equal(
      result.points.reduce((sum, point) => sum + point.count, 0),
      4,
    );
    assert.equal(result.stats.hiddenByRenderBudget, 0);
    console.log("SQLite viewport smoke: complete occupied-cell coverage passed.");
  } finally {
    closeSqliteStore(db);
  }
}

function runDatasetVisibilitySmoke() {
  const { closeSqliteStore } = require("./sqliteStore.cjs");
  const { setSqliteDatasetEnabled } = require("./sqliteDatasetService.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  const db = createSmokeDatabase([
    {
      id: "visible-1",
      datasetId: SMOKE_DATASET_ID,
      lat: 1,
      lon: 1,
      timelineStartYear: 2000,
      timelineEndYear: 2000,
    },
    {
      id: "visible-2",
      datasetId: SMOKE_DATASET_ID,
      lat: 1,
      lon: 1,
      timelineStartYear: 2001,
      timelineEndYear: 2001,
    },
    {
      id: "toggle-match",
      datasetId: SECOND_DATASET_ID,
      lat: 1,
      lon: 1,
      timelineStartYear: 2002,
      timelineEndYear: 2002,
    },
    {
      id: "toggle-outside-timeline",
      datasetId: SECOND_DATASET_ID,
      lat: 1,
      lon: 1,
      timelineStartYear: 1980,
      timelineEndYear: 1980,
    },
  ]);
  const query = {
    db,
    bounds: { north: 10, south: 0, east: 10, west: 0 },
    timeline: { timelineEnabled: true, startYear: 2000, endYear: 2005 },
    renderBudget: 1,
  };

  try {
    setSqliteDatasetEnabled({
      db,
      datasetId: SECOND_DATASET_ID,
      enabled: false,
    });
    const disabledResult = querySqliteMapView(query);
    assert.equal(disabledResult.stats.totalMatchingCount, 2);
    assert.equal(disabledResult.stats.skippedPointsByTimeline, 0);
    assert.equal(disabledResult.points[0].count, 2);

    setSqliteDatasetEnabled({
      db,
      datasetId: SECOND_DATASET_ID,
      enabled: true,
    });
    const enabledResult = querySqliteMapView(query);
    assert.equal(enabledResult.stats.totalMatchingCount, 3);
    assert.equal(enabledResult.stats.skippedPointsByTimeline, 1);
    assert.equal(enabledResult.points[0].count, 3);

    setSqliteDatasetEnabled({
      db,
      datasetId: SECOND_DATASET_ID,
      enabled: false,
    });
    assert.deepEqual(
      querySqliteMapView({ ...query, timeline: null, renderBudget: 10 })
        .points.map((point) => point.id),
      ["visible-1", "visible-2"],
    );

    console.log("SQLite viewport smoke: dataset visibility passed.");
  } finally {
    closeSqliteStore(db);
  }
}

/**
 * Prove small viewport results keep their exact point and source-reference shape.
 */
function runUnderBudgetExactSmoke() {
  const { closeSqliteStore } = require("./sqliteStore.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  const db = createSmokeDatabase([
    {
      id: "setup-point-1",
      lat: 1,
      lon: 1,
      timelineStartYear: 2000,
      timelineEndYear: 2005,
      compactFields: { marker: "blue" },
    },
    {
      id: "setup-point-2",
      lat: 2,
      lon: 2,
      timelineStartYear: 2010,
      timelineEndYear: 2015,
      compactFields: { marker: "red" },
    },
  ]);

  try {
    const result = querySqliteMapView({
      db,
      bounds: {
        north: 10,
        south: 0,
        east: 10,
        west: 0,
      },
      renderBudget: 10,
    });

    assertCompactRenderResult(result);
    assert.deepEqual(
      result.points.map((point) => ({
        id: point.id,
        renderType: point.renderType,
        lat: point.lat,
        lon: point.lon,
        marker: point.marker,
        sourceRef: point.sourceRef,
      })),
      [
        {
          id: "setup-point-1",
          renderType: "exact",
          lat: 1,
          lon: 1,
          marker: "blue",
          sourceRef: {
            datasetId: SMOKE_DATASET_ID,
            rowIndex: 0,
          },
        },
        {
          id: "setup-point-2",
          renderType: "exact",
          lat: 2,
          lon: 2,
          marker: "red",
          sourceRef: {
            datasetId: SMOKE_DATASET_ID,
            rowIndex: 1,
          },
        },
      ],
    );
    assert.equal(result.stats.totalMatchingCount, 2);
    assert.equal(result.stats.returnedCount, 2);
    assert.equal(result.stats.overBudget, false);
    assert.equal(result.stats.limitedToRenderBudget, null);
    assert.equal(result.stats.hiddenByRenderBudget, 0);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.points[0], 'groupRef'),
      false,
    );

    console.log("SQLite viewport smoke: under-budget exact results passed.");
  } finally {
    closeSqliteStore(db);
  }
}

/**
 * Prove dense rows group while an occupied cell with one row stays representative.
 */
function runOverBudgetGroupingSmoke() {
  const { closeSqliteStore } = require("./sqliteStore.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  // Three identical coordinates share a cell; the last point occupies another cell.
  const db = createSmokeDatabase([
    {
      id: "group-point-1",
      lat: 1,
      lon: 1,
      compactFields: { marker: "blue" },
    },
    {
      id: "group-point-2",
      lat: 1,
      lon: 1,
      compactFields: { marker: "red" },
    },
    {
      id: "group-point-3",
      lat: 1,
      lon: 1,
      compactFields: { marker: "green" },
    },
    {
      id: "representative-point",
      lat: 9,
      lon: 9,
      compactFields: { marker: "purple" },
    },
  ]);

  try {
    const result = querySqliteMapView({
      db,
      bounds: {
        north: 10,
        south: 0,
        east: 10,
        west: 0,
      },
      renderBudget: 3,
    });

    assertCompactRenderResult(result);
    assert.deepEqual(
      result.points.map((point) => ({
        id: point.id,
        renderType: point.renderType,
        lat: point.lat,
        lon: point.lon,
        count: point.count,
        groupId: point.groupId,
        sourceRef: point.sourceRef,
        marker: point.marker,
      })),
      [
        {
          id: "grid:0:0",
          renderType: "grouped",
          lat: 1,
          lon: 1,
          count: 3,
          groupId: "grid:0:0",
          sourceRef: null,
          marker: "green",
        },
        {
          id: "grid:0:1",
          renderType: "representative",
          lat: 9,
          lon: 9,
          count: 1,
          groupId: "grid:0:1",
          sourceRef: null,
          marker: "purple",
        },
      ],
    );
    assert.equal(result.stats.totalMatchingCount, 4);
    assert.equal(result.stats.returnedCount, 2);
    assert.equal(result.stats.overBudget, true);
    assert.equal(result.stats.limitedToRenderBudget, 3);
    assert.equal(result.stats.hiddenByRenderBudget, 0);
    assert.deepEqual(
      result.points.map((point) => point.groupRef),
      [
        {
          groupId: 'grid:0:0',
          bounds: {
            north: 10,
            south: 0,
            east: 10,
            west: 0,
          },
          datasetIds: [SMOKE_DATASET_ID],
          timeline: null,
          grid: {
            cellLat: 0,
            cellLon: 0,
            cellHeight: 10,
            cellWidth: 5,
          },
          sortOrder: 'dataset-source-row',
        },
        {
          groupId: 'grid:0:1',
          bounds: {
            north: 10,
            south: 0,
            east: 10,
            west: 0,
          },
          datasetIds: [SMOKE_DATASET_ID],
          timeline: null,
          grid: {
            cellLat: 0,
            cellLon: 1,
            cellHeight: 10,
            cellWidth: 5,
          },
          sortOrder: 'dataset-source-row',
        },
      ],
    );
    const { getSqliteGroupRows } = require('./sqliteDetailQuery.cjs');
    assert.deepEqual(
      result.points.map((point) => (
        getSqliteGroupRows({ db, groupRef: point.groupRef }).totalRows
      )),
      [3, 1],
    );
    assert.equal(
      result.points.reduce((sum, point) => sum + point.count, 0),
      4,
    );

    console.log("SQLite viewport smoke: over-budget grouped results passed.");
  } finally {
    closeSqliteStore(db);
  }
}

/**
 * Prove timeline filtering runs before counts, grouping, and representative selection.
 */
function runTimelineBeforeGroupingSmoke() {
  const { closeSqliteStore } = require("./sqliteStore.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  // The first source row is outside the timeline and must not supply the group marker.
  const db = createSmokeDatabase([
    {
      id: "excluded-before",
      lat: 1,
      lon: 1,
      timelineStartYear: 1980,
      timelineEndYear: 1990,
      compactFields: { marker: "black" },
    },
    {
      id: "timeline-match-1",
      lat: 1,
      lon: 1,
      timelineStartYear: 1995,
      timelineEndYear: 2001,
      compactFields: { marker: "blue" },
    },
    {
      id: "timeline-match-2",
      lat: 1,
      lon: 1,
      timelineStartYear: 2003,
      timelineEndYear: 2003,
      compactFields: { marker: "red" },
    },
    {
      id: "timeline-match-3",
      lat: 1,
      lon: 1,
      timelineStartYear: 2005,
      timelineEndYear: 2010,
      compactFields: { marker: "green" },
    },
    {
      id: "excluded-after",
      lat: 1,
      lon: 1,
      timelineStartYear: 2011,
      timelineEndYear: 2020,
      compactFields: { marker: "purple" },
    },
  ]);

  try {
    const result = querySqliteMapView({
      db,
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
      renderBudget: 2,
    });

    assertCompactRenderResult(result);
    assert.deepEqual(
      result.points.map((point) => ({
        id: point.id,
        renderType: point.renderType,
        count: point.count,
        marker: point.marker,
      })),
      [
        {
          id: "grid:0:0",
          renderType: "grouped",
          count: 3,
          marker: "green",
        },
      ],
    );
    assert.equal(result.stats.totalMatchingCount, 3);
    assert.equal(result.stats.returnedCount, 1);
    assert.equal(result.stats.skippedPointsByTimeline, 2);
    assert.equal(result.stats.skippedByTimeline, 2);
    assert.equal(result.stats.overBudget, true);
    assert.equal(result.stats.limitedToRenderBudget, 2);
    assert.equal(result.stats.hiddenByRenderBudget, 0);
    assert.deepEqual(result.points[0].groupRef, {
      groupId: 'grid:0:0',
      bounds: {
        north: 10,
        south: 0,
        east: 10,
        west: 0,
      },
      datasetIds: [SMOKE_DATASET_ID],
      timeline: {
        timelineEnabled: true,
        startYear: 2000,
        endYear: 2005,
      },
      grid: {
        cellLat: 0,
        cellLon: 0,
        cellHeight: 10,
        cellWidth: 5,
      },
      sortOrder: 'dataset-source-row',
    });
    const { getSqliteGroupRows } = require('./sqliteDetailQuery.cjs');
    assert.equal(
      getSqliteGroupRows({
        db,
        groupRef: result.points[0].groupRef,
      }).totalRows,
      3,
    );

    console.log("SQLite viewport smoke: timeline filtering before grouping passed.");
  } finally {
    closeSqliteStore(db);
  }
}

/**
 * Guard the render contract against accidentally returning stored detail data.
 */
function assertCompactRenderResult(result) {
  assert.equal(
    JSON.stringify(result).includes(ROW_JSON_SENTINEL),
    false,
    "Viewport result exposed full row content.",
  );

  const forbiddenFields = ["row_json", "rowJson", "row", "fullRow", "details"];
  result.points.forEach((point) => {
    forbiddenFields.forEach((field) => {
      assert.equal(
        Object.prototype.hasOwnProperty.call(point, field),
        false,
        `Viewport point exposed forbidden field ${field}.`,
      );
    });
  });
}

/**
 * Create a fresh desktop-compatible SQLite store for one isolated smoke scenario.
 */
function createSmokeDatabase(features) {
  const Database = require("better-sqlite3");
  const { closeSqliteStore, initializeSchema } = require("./sqliteStore.cjs");
  const db = new Database(":memory:");

  try {
    // Reuse the production schema so fixture drift breaks the smoke check visibly.
    initializeSchema(db);

    const insertDataset = db.prepare(`
      INSERT INTO datasets (
        id,
        file_name,
        source_path,
        row_count,
        imported_feature_count,
        skipped_row_count,
        columns_json,
        imported_at
      ) VALUES (
        @id,
        @fileName,
        NULL,
        @rowCount,
        @rowCount,
        0,
        '[]',
        @importedAt
      )
    `);
    const datasetCounts = new Map();
    features.forEach((feature) => {
      const datasetId = feature.datasetId ?? SMOKE_DATASET_ID;
      datasetCounts.set(datasetId, (datasetCounts.get(datasetId) ?? 0) + 1);
    });
    datasetCounts.forEach((rowCount, datasetId) => {
      insertDataset.run({
        id: datasetId,
        fileName: `${datasetId}.csv`,
        rowCount,
        importedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const insertFeature = db.prepare(`
      INSERT INTO features (
        id,
        dataset_id,
        source_row_index,
        lat,
        lon,
        timeline_start_year,
        timeline_end_year,
        compact_json,
        row_json
      ) VALUES (
        @id,
        @datasetId,
        @sourceRowIndex,
        @lat,
        @lon,
        @timelineStartYear,
        @timelineEndYear,
        @compactJson,
        @rowJson
      )
    `);
    const insertFeatures = db.transaction((rows) => {
      rows.forEach((feature, index) => {
        insertFeature.run({
          id: feature.id,
          datasetId: feature.datasetId ?? SMOKE_DATASET_ID,
          sourceRowIndex: feature.sourceRowIndex ?? index,
          lat: feature.lat,
          lon: feature.lon,
          timelineStartYear: feature.timelineStartYear ?? null,
          timelineEndYear: feature.timelineEndYear ?? null,
          compactJson: JSON.stringify(feature.compactFields ?? {}),
          // This recognizable value makes any row_json leak easy to detect.
          rowJson: JSON.stringify({
            smokeSentinel: ROW_JSON_SENTINEL,
            featureId: feature.id,
          }),
        });
      });
    });

    insertFeatures(features);
    return db;
  } catch (error) {
    closeSqliteStore(db);
    throw error;
  }
}

/**
 * Relaunch this file in Electron's Node mode so native modules use Electron's ABI.
 */
function runInElectronNode() {
  const electronPath = require("electron");
  const result = spawnSync(electronPath, [__filename], {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      [ELECTRON_SMOKE_CHILD]: "1",
    },
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(`Electron smoke process stopped by signal ${result.signal}.`);
  }

  process.exitCode = result.status ?? 1;
}

function main() {
  try {
    // The npm command starts in Node; only the child loads Electron-native SQLite.
    if (process.env[ELECTRON_SMOKE_CHILD] !== "1") {
      runInElectronNode();
      return;
    }

    // Fail clearly instead of loading better-sqlite3 under the wrong native ABI.
    if (!process.versions.electron) {
      throw new Error("SQLite viewport smoke check did not start in Electron's Node mode.");
    }

    runSmokeCheck();
  } catch (error) {
    console.error("SQLite viewport smoke check failed.", error);
    process.exitCode = 1;
  }
}

main();
