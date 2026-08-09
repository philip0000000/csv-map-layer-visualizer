"use strict";

const assert = require("node:assert/strict");
const Papa = require("papaparse");
const { exportSqliteDatasetCsv } = require("./sqliteDatasetExport.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");

const db = openSqliteStore(":memory:");

try {
  const headers = ["featureType", "featureId", "part", "lat", "lon", "name", "empty"];
  insertDataset("selected", "desktop-loaded", headers, 3);
  insertDataset("other", "other.csv", ["name", "lat", "lon"], 1);
  insertRows("selected", [
    {
      featureType: "region", featureId: "zone", part: "main",
      lat: "60.25", lon: "19.5", name: "Åland, \"adjusted\"\nzone", empty: "",
    },
    {
      featureType: "line", featureId: "route", part: "",
      lat: "59", lon: "18", name: "Route", empty: "",
    },
    {
      featureType: "marker", featureId: "point", part: "",
      lat: "58", lon: "17", name: "Marker", empty: "",
    },
  ]);
  insertRows("other", [{ name: "must-not-export", lat: "1", lon: "2" }]);

  const exported = exportSqliteDatasetCsv({ db, datasetId: "selected" });
  assert.equal(exported.datasetId, "selected");
  assert.equal(exported.fileName, "desktop-loaded.csv");
  assert.equal(exported.csvText.includes("must-not-export"), false);
  assert.equal(exported.csvText.includes("source_row_index"), false);

  const parsed = Papa.parse(exported.csvText, { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.meta.fields, headers);
  assert.deepEqual(parsed.data.map((row) => row.featureType), ["region", "line", "marker"]);
  assert.equal(parsed.data[0].lat, "60.25");
  assert.equal(parsed.data[0].name, "Åland, \"adjusted\"\nzone");
  assert.equal(parsed.data[0].empty, "");
  assert.throws(() => exportSqliteDatasetCsv({ db, datasetId: "missing" }));
} finally {
  closeSqliteStore(db);
}

console.log("Desktop SQLite dataset CSV export smoke test passed.");

/** Insert desktop dataset metadata with its import-time column ordering. */
function insertDataset(id, fileName, headers, rowCount) {
  db.prepare(`
    INSERT INTO datasets (
      id, file_name, row_count, imported_feature_count, skipped_row_count,
      columns_json, imported_at
    ) VALUES (?, ?, ?, ?, 0, ?, '2026-08-09T00:00:00.000Z')
  `).run(id, fileName, rowCount, rowCount, JSON.stringify(headers));
}

/** Insert accepted desktop rows in stable original source order. */
function insertRows(datasetId, rows) {
  const statement = db.prepare(`
    INSERT INTO features (
      id, dataset_id, source_row_index, lat, lon, compact_json, row_json
    ) VALUES (?, ?, ?, ?, ?, '{}', ?)
  `);
  rows.forEach((row, index) => {
    statement.run(
      `${datasetId}:${index}`,
      datasetId,
      index,
      Number(row.lat),
      Number(row.lon),
      JSON.stringify(row),
    );
  });
}
