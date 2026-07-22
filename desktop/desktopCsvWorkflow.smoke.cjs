"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importCsvFilesToSqlite } = require("./csvImportService.cjs");
const {
  getSqliteDatasetSummary,
  removeSqliteDataset,
  setSqliteDatasetEnabled,
} = require("./sqliteDatasetService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");
const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-workflow-"));
const dbPath = path.join(tempDir, "workflow.sqlite");
const citiesPath = path.join(tempDir, "cities.csv");
const castlesPath = path.join(tempDir, "castles.csv");
const citiesContents = "lat,lon,name,year\n1,2,City One,1200\n3,4,City Two,1300\n";
const castlesContents = "lat,lon,name,year\n5,6,Castle One,1250\n";
fs.writeFileSync(citiesPath, citiesContents, "utf8");
fs.writeFileSync(castlesPath, castlesContents, "utf8");

let db = openSqliteStore(dbPath);

try {
  const importResult = importCsvFilesToSqlite({
    db,
    filePaths: [citiesPath, castlesPath],
  });
  assert.equal(importResult.ok, true);
  assert.equal(importResult.successfulCount, 2);
  assert.equal(importResult.failedCount, 0);
  assert.equal(JSON.stringify(importResult).includes(tempDir), false);

  let summary = getSqliteDatasetSummary({ db });
  assert.equal(summary.datasets.length, 2);
  assert.ok(summary.datasets.every((dataset) => dataset.enabled));
  assertPublicSummary(summary);

  const cities = summary.datasets.find((dataset) => dataset.name === "cities.csv");
  const castles = summary.datasets.find((dataset) => dataset.name === "castles.csv");
  assert.ok(cities);
  assert.ok(castles);

  const query = {
    db,
    bounds: { north: 10, south: 0, east: 10, west: 0 },
    renderBudget: 100,
  };
  let mapResult = querySqliteMapView(query);
  assert.equal(mapResult.points.length, 3);
  assertCompactMapResult(mapResult);

  assert.deepEqual(setSqliteDatasetEnabled({
    db,
    datasetId: castles.id,
    enabled: false,
  }), { updated: true });
  mapResult = querySqliteMapView(query);
  assert.equal(mapResult.points.length, 2);
  assert.ok(mapResult.points.every(
    (point) => point.sourceRef.datasetId === cities.id,
  ));

  closeSqliteStore(db);
  db = openSqliteStore(dbPath);
  query.db = db;

  summary = getSqliteDatasetSummary({ db });
  assert.equal(
    summary.datasets.find((dataset) => dataset.id === castles.id)?.enabled,
    false,
  );
  assert.equal(querySqliteMapView(query).points.length, 2);

  assert.deepEqual(setSqliteDatasetEnabled({
    db,
    datasetId: castles.id,
    enabled: true,
  }), { updated: true });
  assert.equal(querySqliteMapView(query).points.length, 3);

  assert.deepEqual(removeSqliteDataset({
    db,
    datasetId: cities.id,
  }), { removed: true });
  summary = getSqliteDatasetSummary({ db });
  assert.deepEqual(summary.datasets.map((dataset) => dataset.id), [castles.id]);
  assert.equal(countFeatures(db, cities.id), 0);
  assert.equal(countFeatures(db, castles.id), 1);
  assert.equal(querySqliteMapView(query).points.length, 1);

  assert.equal(fs.readFileSync(citiesPath, "utf8"), citiesContents);
  assert.equal(fs.readFileSync(castlesPath, "utf8"), castlesContents);

  assert.deepEqual(removeSqliteDataset({
    db,
    datasetId: castles.id,
  }), { removed: true });
  assert.deepEqual(getSqliteDatasetSummary({ db }), {
    datasets: [],
    timeline: null,
  });
  assert.equal(countFeatures(db), 0);
  assert.equal(querySqliteMapView(query).points.length, 0);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");

  console.log("Desktop SQLite CSV workflow smoke test passed.");
} finally {
  closeSqliteStore(db);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function assertPublicSummary(summary) {
  assert.equal(JSON.stringify(summary).includes(tempDir), false);
  summary.datasets.forEach((dataset) => {
    assert.equal(Object.hasOwn(dataset, "rows"), false);
    assert.equal(Object.hasOwn(dataset, "sourcePath"), false);
  });
}

function assertCompactMapResult(result) {
  assert.equal(JSON.stringify(result).includes(tempDir), false);
  result.points.forEach((point) => {
    assert.equal(Object.hasOwn(point, "row"), false);
    assert.equal(Object.hasOwn(point, "rowJson"), false);
    assert.equal(Object.hasOwn(point, "fullRow"), false);
  });
}

function countFeatures(targetDb, datasetId = null) {
  if (datasetId == null) {
    return targetDb.prepare("SELECT COUNT(*) AS count FROM features").get().count;
  }

  return targetDb.prepare(`
    SELECT COUNT(*) AS count
    FROM features
    WHERE dataset_id = ?
  `).get(datasetId).count;
}
