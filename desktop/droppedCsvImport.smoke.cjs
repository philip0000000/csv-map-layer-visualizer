"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importDroppedCsvFilesToSqlite } = require("./droppedCsvImport.cjs");
const { getSqliteDatasetSummary } = require("./sqliteDatasetService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-drop-import-"));

try {
  const firstPath = path.join(tempDir, "first.csv");
  const secondPath = path.join(tempDir, "second.csv");
  const textPath = path.join(tempDir, "notes.txt");
  const missingPath = path.join(tempDir, "missing.csv");
  const directoryPath = path.join(tempDir, "folder.csv");
  fs.writeFileSync(firstPath, "lat,lon,name\n1,2,one\n", "utf8");
  fs.writeFileSync(secondPath, "lat,lon,name\n3,4,two\n", "utf8");
  fs.writeFileSync(textPath, "not a csv", "utf8");
  fs.mkdirSync(directoryPath);

  const db = openSqliteStore(path.join(tempDir, "drop.sqlite"));
  try {
    const progressEvents = [];
    const result = importDroppedCsvFilesToSqlite({
      db,
      filePaths: [
        firstPath,
        textPath,
        firstPath,
        missingPath,
        directoryPath,
        secondPath,
      ],
      onProgress: (progress) => progressEvents.push(progress),
    });

    assert.equal(result.ok, true);
    assert.equal(result.successfulCount, 2);
    assert.equal(result.failedCount, 3);
    assert.deepEqual(result.results.map((item) => [item.ok, item.fileName]), [
      [true, "first.csv"],
      [true, "second.csv"],
      [false, "notes.txt"],
      [false, "missing.csv"],
      [false, "folder.csv"],
    ]);
    assert.deepEqual(progressEvents.map((event) => [
      event.state,
      event.fileName,
      event.fileNumber,
      event.totalFiles,
    ]), [
      ["started", "first.csv", 1, 2],
      ["completed", "first.csv", 1, 2],
      ["started", "second.csv", 2, 2],
      ["completed", "second.csv", 2, 2],
    ]);
    assert.equal(getSqliteDatasetSummary({ db }).datasets.length, 2);
    assert.equal(JSON.stringify(result).includes(tempDir), false);
    assert.equal(JSON.stringify(progressEvents).includes(tempDir), false);
    assert.equal(fs.readFileSync(firstPath, "utf8"), "lat,lon,name\n1,2,one\n");
  } finally {
    closeSqliteStore(db);
  }

  console.log("SQLite dropped CSV import smoke test passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
