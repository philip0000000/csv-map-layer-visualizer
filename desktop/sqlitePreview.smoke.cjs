"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Papa = require("papaparse");
const { getSqlitePreviewFeature } = require("./sqlitePreviewFeature.cjs");
const { importCsvFileToSqlite } = require("./csvImportService.cjs");
const { openSqliteStore, closeSqliteStore } = require("./sqliteStore.cjs");
const { getSqliteDatasetSummary, getSqlitePreviewPage, removeSqliteDataset,
  setSqliteDatasetEnabled } = require("./sqliteDatasetService.cjs");
const { exportSqliteDatasetCsv } = require("./sqliteDatasetExport.cjs");
const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-source-preview-"));
try {
  verifyCompleteImports();
  verifyLegacyMigration();
  console.log("Desktop source-row preservation, migration, and Preview paging passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

/** Exercise complete source storage, bounded paging, visibility isolation, and rollback. */
function verifyCompleteImports() {
  const db = openSqliteStore(":memory:");
  try {
    const rows = Array.from({ length: 65 }, (_, index) => ({
      name: index < 2 ? "Duplicate" : `Row ${index}`,
      lat: index % 2 === 0 ? "59" : "bad", lon: "18", year: "1200",
    }));
    rows[1] = { ...rows[0] };
    const csvPath = path.join(tempDir, "mixed.csv");
    fs.writeFileSync(csvPath, Papa.unparse(rows));
    const imported = importCsvFileToSqlite({ db, filePath: csvPath });
    const datasetId = imported.datasetId;
    assert.equal(getSqlitePreviewFeature({ db, sourceRef: { datasetId, rowIndex: 0 } }).points[0].sourceRef.rowIndex, 0);
    assert.deepEqual(getSqlitePreviewFeature({ db, sourceRef: { datasetId, rowIndex: 3 } }), {});
    assert.equal(imported.rowCount, 65);
    assert.equal(imported.importedFeatureCount, 34);
    assert.equal(imported.skippedRowCount, 31);
    const pages = [0, 30, 60].map((offset) => getSqlitePreviewPage({ db, datasetId, offset }));
    assert.deepEqual(pages.map((page) => page.rows.length), [30, 30, 5]);
    assert.deepEqual(pages.map((page) => page.hasMore), [true, true, false]);
    assert.deepEqual(pages.flatMap((page) => page.rows), rows);
    assert.deepEqual(pages.flatMap((page) => page.sourceRowIndices), rows.map((_, i) => i));
    assert.equal(getSqlitePreviewPage({ db, datasetId, limit: 10000 }).limit, 200);
    assert.equal(getSqlitePreviewPage({ db, datasetId, offset: 100 }).rows.length, 0);
    for (const query of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: Infinity }]) {
      assert.throws(() => getSqlitePreviewPage({ db, datasetId, ...query }));
    }
    assert.throws(() => getSqlitePreviewPage({ db, datasetId: "missing" }));

    const viewQuery = { db, bounds: { north: 90, south: -90, east: 180, west: -180 } };
    assert.equal(querySqliteMapView(viewQuery).points.length, 34);
    assert.equal(querySqliteMapView({ ...viewQuery,
      timeline: { timelineEnabled: true, startYear: 1900, endYear: 2000 },
    }).points.length, 0);
    setSqliteDatasetEnabled({ db, datasetId, enabled: false });
    assert.equal(querySqliteMapView(viewQuery).points.length, 0);
    assert.deepEqual(getSqlitePreviewPage({ db, datasetId }).rows, rows.slice(0, 30));
    assert.deepEqual(Papa.parse(exportSqliteDatasetCsv({ db, datasetId }).csvText,
      { header: true }).data, rows);

    const unmappedPath = path.join(tempDir, "unmapped.csv");
    fs.writeFileSync(unmappedPath, "name,note\nSame,\nSame,\n");
    const unmapped = importCsvFileToSqlite({ db, filePath: unmappedPath });
    assert.equal(unmapped.importedFeatureCount, 0);
    assert.deepEqual(getSqlitePreviewPage({ db, datasetId: unmapped.datasetId }).rows,
      [{ name: "Same", note: "" }, { name: "Same", note: "" }]);
    assert.equal(getSqliteDatasetSummary({ db }).datasets.every((d) => d.missingSourceRowCount === 0), true);

    // An insert failure must roll back metadata, source rows, and derived features together.
    db.exec(`CREATE TRIGGER fail_source_import BEFORE INSERT ON source_rows
      WHEN NEW.source_row_index = 1 BEGIN SELECT RAISE(ABORT, 'forced failure'); END;`);
    assert.throws(() => importCsvFileToSqlite({ db, filePath: unmappedPath }));
    assert.equal(getSqliteDatasetSummary({ db }).datasets.length, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_rows").get().n, 67);
    db.exec("DROP TRIGGER fail_source_import");
    removeSqliteDataset({ db, datasetId });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_rows WHERE dataset_id = ?").get(datasetId).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM features WHERE dataset_id = ?").get(datasetId).n, 0);
    assert.equal(getSqlitePreviewPage({ db, datasetId: unmapped.datasetId }).totalRows, 2);
  } finally {
    closeSqliteStore(db);
  }
}

/** Recreate a version-one database with edited values and gaps, then reopen twice. */
function verifyLegacyMigration() {
  const dbPath = path.join(tempDir, "legacy.sqlite");
  let db = openSqliteStore(dbPath);
  try {
    // Reproduce the previous schema without source storage; no original CSV is present.
    db.exec(`DROP TRIGGER features_insert_source_row;
      DROP TRIGGER features_update_source_row; DROP TABLE source_rows; PRAGMA user_version = 1;
      INSERT INTO datasets (id, file_name, row_count, imported_feature_count,
        skipped_row_count, columns_json, imported_at)
      VALUES ('legacy', 'legacy.csv', 4, 2, 2, '["name","lat","lon"]', '2026-01-01');`);
    const insert = db.prepare(`INSERT INTO features
      (id, dataset_id, source_row_index, lat, lon, row_json)
      VALUES (?, 'legacy', ?, 59, 18, ?)`);
    insert.run("legacy:0", 0, JSON.stringify({ name: "Edited", lat: "59", lon: "18" }));
    insert.run("legacy:3", 3, JSON.stringify({ name: "Last", lat: "60", lon: "19" }));
    closeSqliteStore(db);
    db = openSqliteStore(dbPath);
    let summary = getSqliteDatasetSummary({ db }).datasets[0];
    assert.equal(summary.totalRows, 2);
    assert.equal(summary.missingSourceRowCount, 2);
    const first = getSqlitePreviewPage({ db, datasetId: "legacy", limit: 1 });
    const second = getSqlitePreviewPage({ db, datasetId: "legacy", offset: 1, limit: 1 });
    assert.deepEqual(first.sourceRowIndices, [0]);
    assert.deepEqual(second.sourceRowIndices, [3]);
    assert.equal(first.rows[0].name, "Edited");
    assert.equal(second.hasMore, false);
    // Existing feature writers stay synchronized after migration too.
    db.prepare("UPDATE features SET row_json = ? WHERE id = 'legacy:0'")
      .run(JSON.stringify({ name: "Edited again", lat: "59", lon: "18" }));
    closeSqliteStore(db);
    db = openSqliteStore(dbPath);
    summary = getSqliteDatasetSummary({ db }).datasets[0];
    assert.equal(summary.totalRows, 2);
    assert.equal(summary.missingSourceRowCount, 2);
    assert.equal(getSqlitePreviewPage({ db, datasetId: "legacy" }).rows[0].name, "Edited again");
    assert.equal(db.pragma("user_version", { simple: true }), 2);
  } finally {
    closeSqliteStore(db);
  }
}
