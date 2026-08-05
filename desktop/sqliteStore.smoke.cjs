"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  closeSqliteStore,
  initializeSchema,
  openSqliteStore,
} = require("./sqliteStore.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-sqlite-store-"));

try {
  verifyNewDatabase();
  verifyLegacyDatabaseMigration();
  console.log("SQLite store smoke test passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function verifyNewDatabase() {
  const dbPath = path.join(tempDir, "new.sqlite");
  const db = openSqliteStore(dbPath);

  try {
    const enabledColumn = getEnabledColumn(db);
    assert.ok(enabledColumn);
    assert.equal(Number(enabledColumn.notnull), 1);
    assert.equal(String(enabledColumn.dflt_value), "1");
    assert.equal(countRecommendedTimelineColumns(db), 2);

    insertDataset(db, "new-dataset");
    assert.equal(getDatasetEnabled(db, "new-dataset"), 1);

    initializeSchema(db);
    assert.equal(countEnabledColumns(db), 1);
  } finally {
    closeSqliteStore(db);
  }
}

function verifyLegacyDatabaseMigration() {
  const dbPath = path.join(tempDir, "legacy.sqlite");
  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE datasets (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        source_path TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        imported_feature_count INTEGER NOT NULL DEFAULT 0,
        skipped_row_count INTEGER NOT NULL DEFAULT 0,
        columns_json TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL
      );
    `);
    insertDataset(db, "legacy-dataset");

    initializeSchema(db);

    assert.equal(countEnabledColumns(db), 1);
    assert.equal(getDatasetEnabled(db, "legacy-dataset"), 1);
    assert.equal(countRecommendedTimelineColumns(db), 2);

    initializeSchema(db);
    assert.equal(countEnabledColumns(db), 1);
    assert.equal(getDatasetEnabled(db, "legacy-dataset"), 1);
    assert.equal(countRecommendedTimelineColumns(db), 2);
  } finally {
    closeSqliteStore(db);
  }
}

function insertDataset(db, id) {
  db.prepare(`
    INSERT INTO datasets (
      id,
      file_name,
      row_count,
      imported_feature_count,
      skipped_row_count,
      columns_json,
      imported_at
    ) VALUES (?, ?, 0, 0, 0, '[]', ?)
  `).run(id, `${id}.csv`, new Date(0).toISOString());
}

function getEnabledColumn(db) {
  return db.pragma("table_info(datasets)")
    .find((column) => column.name === "enabled");
}

function countEnabledColumns(db) {
  return db.pragma("table_info(datasets)")
    .filter((column) => column.name === "enabled")
    .length;
}

function countRecommendedTimelineColumns(db) {
  return db.pragma("table_info(datasets)")
    .filter((column) => column.name.startsWith("recommended_timeline_"))
    .length;
}

function getDatasetEnabled(db, id) {
  return db.prepare("SELECT enabled FROM datasets WHERE id = ?").get(id)?.enabled;
}
