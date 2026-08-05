"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importCsvFilesToSqlite } = require("./csvImportService.cjs");
const { getSqliteDatasetSummary } = require("./sqliteDatasetService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-batch-import-"));

try {
  verifyMixedBatchImport();
  verifyFailedImportRollsBack();
  console.log("SQLite CSV batch import smoke test passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function verifyMixedBatchImport() {
  const firstPath = path.join(tempDir, "first.csv");
  const secondPath = path.join(tempDir, "second.csv");
  const missingPath = path.join(tempDir, "missing.csv");
  fs.writeFileSync(firstPath, "lat,lon,name,year\n1,2,one,900\n3,4,two,1200\n", "utf8");
  fs.writeFileSync(secondPath, "lat,lon,name\n5,6,three\nbad,7,skip\n", "utf8");

  const db = openSqliteStore(path.join(tempDir, "mixed.sqlite"));
  try {
    const progressEvents = [];
    const result = importCsvFilesToSqlite({
      db,
      filePaths: [firstPath, missingPath, secondPath],
      onProgress: (progress) => progressEvents.push(progress),
    });

    assert.equal(result.ok, true);
    assert.equal(result.successfulCount, 2);
    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.results.map((item) => ({
      ok: item.ok,
      fileName: item.fileName,
      importedFeatureCount: item.importedFeatureCount,
      skippedRowCount: item.skippedRowCount,
    })), [
      { ok: true, fileName: "first.csv", importedFeatureCount: 2, skippedRowCount: 0 },
      { ok: false, fileName: "missing.csv", importedFeatureCount: undefined, skippedRowCount: undefined },
      { ok: true, fileName: "second.csv", importedFeatureCount: 1, skippedRowCount: 1 },
    ]);
    assert.equal(JSON.stringify(result).includes(tempDir), false);
    assert.deepEqual(progressEvents, [
      { state: "started", fileName: "first.csv", fileNumber: 1, totalFiles: 3 },
      { state: "completed", fileName: "first.csv", fileNumber: 1, totalFiles: 3, ok: true },
      { state: "started", fileName: "missing.csv", fileNumber: 2, totalFiles: 3 },
      { state: "completed", fileName: "missing.csv", fileNumber: 2, totalFiles: 3, ok: false },
      { state: "started", fileName: "second.csv", fileNumber: 3, totalFiles: 3 },
      { state: "completed", fileName: "second.csv", fileNumber: 3, totalFiles: 3, ok: true },
    ]);
    assert.equal(JSON.stringify(progressEvents).includes(tempDir), false);
    const datasets = getSqliteDatasetSummary({ db }).datasets;
    assert.equal(datasets.length, 2);
    assert.deepEqual(
      datasets.find((dataset) => dataset.name === "first.csv")
        ?.recommendedTimelineRange,
      { startYear: 900, endYear: 1200 },
    );
    assert.equal(
      datasets.find((dataset) => dataset.name === "second.csv")
        ?.recommendedTimelineRange,
      null,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM features").get().count, 3);
  } finally {
    closeSqliteStore(db);
  }
}

function verifyFailedImportRollsBack() {
  const csvPath = path.join(tempDir, "rollback.csv");
  fs.writeFileSync(csvPath, "lat,lon,name\n1,2,keep\n3,4,rollback\n", "utf8");

  const db = openSqliteStore(path.join(tempDir, "rollback.sqlite"));
  try {
    db.exec(`
      CREATE TRIGGER reject_rollback_row
      BEFORE INSERT ON features
      WHEN NEW.row_json LIKE '%rollback%'
      BEGIN
        SELECT RAISE(ABORT, 'rejected smoke row');
      END;
    `);

    const result = importCsvFilesToSqlite({ db, filePaths: [csvPath] });
    assert.equal(result.ok, false);
    assert.equal(result.successfulCount, 0);
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].fileName, "rollback.csv");
    assert.equal(getSqliteDatasetSummary({ db }).datasets.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM features").get().count, 0);
  } finally {
    closeSqliteStore(db);
  }
}
