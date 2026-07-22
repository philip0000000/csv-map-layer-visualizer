"use strict";

const Database = require("better-sqlite3");

/**
 * Open the SQLite database and make sure the prototype schema exists.
 */
function openSqliteStore(dbPath) {
  if (!dbPath || typeof dbPath !== "string") {
    throw new TypeError("A SQLite database path is required.");
  }

  const db = new Database(dbPath);
  initializeSchema(db);
  return db;
}

/**
 * Create the import schema and future query indexes.
 * Later issues can query these tables without changing the browser CSV flow.
 */
function initializeSchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      source_path TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_feature_count INTEGER NOT NULL DEFAULT 0,
      skipped_row_count INTEGER NOT NULL DEFAULT 0,
      columns_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      timeline_start_year INTEGER,
      timeline_end_year INTEGER,
      compact_json TEXT NOT NULL DEFAULT '{}',
      row_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_features_dataset
      ON features(dataset_id);

    CREATE INDEX IF NOT EXISTS idx_features_dataset_lat_lon
      ON features(dataset_id, lat, lon);

    CREATE INDEX IF NOT EXISTS idx_features_dataset_timeline
      ON features(dataset_id, timeline_start_year, timeline_end_year);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_features_dataset_source_row
      ON features(dataset_id, source_row_index);
  `);

  ensureDatasetEnabledColumn(db);
}

/**
 * Add persistent visibility to databases created before the column existed.
 * The non-null default makes every existing dataset visible after migration.
 */
function ensureDatasetEnabledColumn(db) {
  const columns = db.pragma("table_info(datasets)");
  const hasEnabledColumn = columns.some((column) => column.name === "enabled");

  if (hasEnabledColumn) return;

  db.exec(`
    ALTER TABLE datasets
    ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
  `);
}

/**
 * Close the database if it is still open.
 */
function closeSqliteStore(db) {
  if (db?.open) {
    db.close();
  }
}

module.exports = {
  closeSqliteStore,
  initializeSchema,
  openSqliteStore,
};
