"use strict";

const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { initializeSchema } = require("./sqliteStore.cjs");
const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
const {
  getSqliteLogicalZone,
  rebuildSqliteDatasetRegions,
  updateSqliteLogicalZone,
} = require("./sqliteZoneService.cjs");

const db = new Database(":memory:");
try {
  initializeSchema(db);
  db.prepare(`
    INSERT INTO datasets (
      id, file_name, row_count, imported_feature_count, skipped_row_count,
      columns_json, imported_at
    ) VALUES ('dataset-a', 'zones.csv', 6, 6, 0, '[]', '2026-08-08T00:00:00.000Z')
  `).run();
  const insert = db.prepare(`
    INSERT INTO features (
      id, dataset_id, source_row_index, lat, lon, compact_json, row_json
    ) VALUES (?, 'dataset-a', ?, ?, ?, ?, ?)
  `);
  const vertices = [
    ["main", 1, 1], ["main", 1, 2], ["main", 2, 1],
    ["island", 5, 5], ["island", 5, 6], ["island", 6, 5],
  ];
  vertices.forEach(([part, lat, lon], index) => insert.run(
    `dataset-a:${index}`,
    index,
    lat,
    lon,
    JSON.stringify({
      featureType: "region",
      featureId: "zone",
      part,
      order: String((index % 3) + 1),
      latField: "lat",
      lonField: "lon",
    }),
    JSON.stringify({ name: "Zone", lat: String(lat), lon: String(lon) }),
  ));
  rebuildSqliteDatasetRegions({ db, datasetId: "dataset-a" });

  const zone = getSqliteLogicalZone({ db, datasetId: "dataset-a", featureId: "zone" });
  assert.deepEqual(zone.parts.map((part) => part.part), ["main", "island"]);
  const mapView = querySqliteMapView({
    db,
    bounds: { north: 10, south: 0, east: 10, west: 0 },
    renderBudget: 100,
  });
  assert.equal(mapView.points.length, 0);
  assert.equal(mapView.regions.length, 2);
  const movedParts = zone.parts.map((part) => ({
    part: part.part,
    coordinates: part.coordinates.map(([lat, lon]) => [lat + 1, lon + 2]),
  }));
  updateSqliteLogicalZone({
    db,
    datasetId: "dataset-a",
    featureId: "zone",
    parts: movedParts,
  });
  assert.deepEqual(
    getSqliteLogicalZone({ db, datasetId: "dataset-a", featureId: "zone" }).parts[0].coordinates,
    movedParts[0].coordinates,
  );
  assert.deepEqual(
    db.prepare("SELECT lat, lon FROM features WHERE id = 'dataset-a:0'").get(),
    { lat: 2, lon: 3 },
  );

  db.exec(`
    CREATE TRIGGER fail_zone_update BEFORE UPDATE ON geometry_features
    BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
  `);
  assert.throws(() => updateSqliteLogicalZone({
    db,
    datasetId: "dataset-a",
    featureId: "zone",
    parts: movedParts.map((part) => ({
      ...part,
      coordinates: part.coordinates.map(([lat, lon]) => [lat + 1, lon + 1]),
    })),
  }));
  assert.deepEqual(
    db.prepare("SELECT lat, lon FROM features WHERE id = 'dataset-a:0'").get(),
    { lat: 2, lon: 3 },
  );
} finally {
  db.close();
}

console.log("Desktop SQLite logical-zone transaction smoke test passed.");
