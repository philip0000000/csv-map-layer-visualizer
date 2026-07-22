"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getSqliteDatasetSummary,
  removeSqliteDataset,
  setSqliteDatasetEnabled,
} = require("./sqliteDatasetService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-dataset-summary-"));
const db = openSqliteStore(path.join(tempDir, "summary.sqlite"));

try {
  assert.deepEqual(getSqliteDatasetSummary({ db }), {
    datasets: [],
    timeline: null,
  });

  insertDataset({
    id: "older",
    fileName: "older.csv",
    rowCount: 8,
    importedFeatureCount: 6,
    skippedRowCount: 2,
    columnsJson: JSON.stringify(["name", "lat", "lon"]),
    enabled: 0,
    importedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.deepEqual(getSqliteDatasetSummary({ db }).datasets, [
    {
      id: "older",
      name: "older.csv",
      enabled: false,
      headers: ["name", "lat", "lon"],
      rowCount: 8,
      totalRows: 8,
      importedFeatureCount: 6,
      skippedRowCount: 2,
      importedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  insertDataset({
    id: "newer-b",
    fileName: "newer-b.csv",
    rowCount: 4,
    importedFeatureCount: 4,
    skippedRowCount: 0,
    columnsJson: "not-json",
    enabled: 1,
    importedAt: "2026-02-01T00:00:00.000Z",
  });
  insertDataset({
    id: "newer-a",
    fileName: "newer-a.csv",
    rowCount: 3,
    importedFeatureCount: 3,
    skippedRowCount: 0,
    columnsJson: JSON.stringify(["lat", 42, "lon"]),
    enabled: 1,
    importedAt: "2026-02-01T00:00:00.000Z",
  });

  const summary = getSqliteDatasetSummary({ db });
  assert.deepEqual(summary.datasets.map((dataset) => dataset.id), [
    "newer-a",
    "newer-b",
    "older",
  ]);
  assert.deepEqual(summary.datasets[0].headers, ["lat", "lon"]);
  assert.deepEqual(summary.datasets[1].headers, []);

  assert.deepEqual(setSqliteDatasetEnabled({
    db,
    datasetId: "older",
    enabled: true,
  }), { updated: true });
  assert.deepEqual(setSqliteDatasetEnabled({
    db,
    datasetId: "newer-a",
    enabled: false,
  }), { updated: true });

  const visibilityById = Object.fromEntries(
    getSqliteDatasetSummary({ db }).datasets
      .map((dataset) => [dataset.id, dataset.enabled]),
  );
  assert.deepEqual(visibilityById, {
    "newer-a": false,
    "newer-b": true,
    older: true,
  });

  assert.deepEqual(setSqliteDatasetEnabled({
    db,
    datasetId: "missing",
    enabled: false,
  }), { updated: false });
  assert.throws(
    () => setSqliteDatasetEnabled({ db, datasetId: "", enabled: true }),
    /dataset ID/i,
  );
  assert.throws(
    () => setSqliteDatasetEnabled({ db, datasetId: "older", enabled: 0 }),
    /boolean/i,
  );

  insertFeature("older", 0);
  insertFeature("newer-a", 0);
  insertFeature("newer-b", 0);
  const sourceCsvPath = path.join(tempDir, "original.csv");
  const sourceCsvContents = "lat,lon\n1,2\n";
  fs.writeFileSync(sourceCsvPath, sourceCsvContents, "utf8");
  db.prepare("UPDATE datasets SET source_path = ? WHERE id = ?")
    .run(sourceCsvPath, "older");

  closeSqliteStore(db);
  const reopenedDb = openSqliteStore(path.join(tempDir, "summary.sqlite"));
  try {
    const persistedVisibilityById = Object.fromEntries(
      getSqliteDatasetSummary({ db: reopenedDb }).datasets
        .map((dataset) => [dataset.id, dataset.enabled]),
    );
    assert.deepEqual(persistedVisibilityById, visibilityById);

    assert.deepEqual(removeSqliteDataset({
      db: reopenedDb,
      datasetId: "missing",
    }), { removed: false });
    assert.throws(
      () => removeSqliteDataset({ db: reopenedDb, datasetId: " " }),
      /dataset ID/i,
    );

    assert.deepEqual(removeSqliteDataset({
      db: reopenedDb,
      datasetId: "older",
    }), { removed: true });
    assert.deepEqual(
      getSqliteDatasetSummary({ db: reopenedDb }).datasets
        .map((dataset) => [dataset.id, dataset.enabled]),
      [["newer-a", false], ["newer-b", true]],
    );
    assert.equal(countFeatures(reopenedDb, "older"), 0);
    assert.equal(countFeatures(reopenedDb, "newer-a"), 1);
    assert.equal(countFeatures(reopenedDb, "newer-b"), 1);
    assert.equal(fs.readFileSync(sourceCsvPath, "utf8"), sourceCsvContents);

    assert.deepEqual(removeSqliteDataset({
      db: reopenedDb,
      datasetId: "newer-a",
    }), { removed: true });
    assert.deepEqual(removeSqliteDataset({
      db: reopenedDb,
      datasetId: "newer-b",
    }), { removed: true });
    assert.deepEqual(getSqliteDatasetSummary({ db: reopenedDb }), {
      datasets: [],
      timeline: null,
    });
    assert.equal(countFeatures(reopenedDb), 0);
  } finally {
    closeSqliteStore(reopenedDb);
  }

  console.log("SQLite dataset summary, visibility, and removal smoke test passed.");
} finally {
  closeSqliteStore(db);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function insertDataset({
  id,
  fileName,
  rowCount,
  importedFeatureCount,
  skippedRowCount,
  columnsJson,
  enabled,
  importedAt,
}) {
  db.prepare(`
    INSERT INTO datasets (
      id,
      file_name,
      row_count,
      imported_feature_count,
      skipped_row_count,
      columns_json,
      enabled,
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    fileName,
    rowCount,
    importedFeatureCount,
    skippedRowCount,
    columnsJson,
    enabled,
    importedAt,
  );
}

function insertFeature(datasetId, sourceRowIndex) {
  db.prepare(`
    INSERT INTO features (
      id,
      dataset_id,
      source_row_index,
      lat,
      lon,
      compact_json,
      row_json
    ) VALUES (?, ?, ?, 1, 2, '{}', '{}')
  `).run(`${datasetId}:${sourceRowIndex}`, datasetId, sourceRowIndex);
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
