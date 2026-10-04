"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { openSqliteStore, closeSqliteStore } = require('./sqliteStore.cjs');
const { importMapFilesToSqlite } = require('./mapImportService.cjs');
const { querySqliteMapView } = require('./sqliteViewportQuery.cjs');
const { getSqliteFeatureDetails } = require('./sqliteDetailQuery.cjs');
const { getSqliteLogicalZone, updateSqliteLogicalZone } = require('./sqliteZoneService.cjs');
const { getSqlitePreviewFeature } = require('./sqlitePreviewFeature.cjs');
const { createSqliteAdapter } = require('./sqliteAdapter.cjs');
const { exportDatasetGeojson } = require('../src/data/geojsonExport.js');
const { transformZoneParts } = require('../src/components/zoneTransform.js');
const Papa = require('papaparse');

/** Exercise native SQLite with real file streams and lossless gzip inputs. */
async function run() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      stdio: 'inherit', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Native import smoke test failed.');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-map-geojson-smoke-'));
  const files = [];
  const db = openSqliteStore(':memory:');
  const adapter = createSqliteAdapter(db);
  const feature = { type: 'Feature', id: 0, properties: { name: 'Mixed', year: 1300, nested: [1, false, null] },
    geometry: { type: 'GeometryCollection', geometries: [
      { type: 'MultiPoint', coordinates: [[18, 59], [19, 60]] },
      { type: 'LineString', coordinates: [[18, 59], [19, 60]] },
      { type: 'Polygon', coordinates: [
        [[18, 59, 10], [19, 59, 11], [19, 60, 12], [18, 59, 10]],
        [[18.2, 59.1, 1], [18.3, 59.1, 2], [18.3, 59.2, 3], [18.2, 59.1, 1]],
      ] },
    ] } };
  const document = { type: 'FeatureCollection', features: [feature, { type: 'Feature', id: 0, properties: null, geometry: null }] };
  const write = (name, contents) => {
    const target = path.join(directory, name);
    fs.writeFileSync(target, contents);
    files.push(target);
    return target;
  };
  try {
    const filePaths = [write('plain.geojson', JSON.stringify(document)), write('gzip.geojson.gz', gzipSync(JSON.stringify(document)))];
    const result = await importMapFilesToSqlite({ db, filePaths });
    assert.equal(result.successfulCount, 2);
    for (const imported of result.results) {
      assert.equal(imported.rowCount, 2);
      assert.equal(imported.importedFeatureCount, 4);
      const details = getSqliteFeatureDetails({ db, sourceRef: { datasetId: imported.datasetId, rowIndex: 0 } });
      assert.deepEqual(details.row.nested, [1, false, null]);
      assert.deepEqual(JSON.parse(exportDatasetGeojson(adapter, imported.datasetId).geojsonText).features, document.features);
    }
    const map = querySqliteMapView({ db, bounds: { south: 50, north: 70, west: 10, east: 30 } });
    assert.equal(map.points.length, 4);
    assert.equal(map.lines.length, 2);
    assert.equal(map.regions.length, 2);
    assert.equal(map.regions[0].coordinates.length, 2);
    const datasetId = result.results[0].datasetId;
    const zone = getSqliteLogicalZone({ db, datasetId, featureId: 'geojson:0' });
    const moved = transformZoneParts(zone.parts, { operation: 'move', center: { lat: 59, lng: 18 },
      start: { lat: 59, lng: 18 }, current: { lat: 59.1, lng: 18.1 } });
    updateSqliteLogicalZone({ db, datasetId, featureId: 'geojson:0', parts: moved });
    const edited = JSON.parse(exportDatasetGeojson(adapter, datasetId).geojsonText).features[0];
    assert.deepEqual(edited.geometry.geometries[0], feature.geometry.geometries[0]);
    assert.equal(edited.geometry.geometries[2].coordinates[0][0][2], 10);
    assert.notDeepEqual(edited.geometry.geometries[2], feature.geometry.geometries[2]);

    const compact = Papa.unparse([{ lat: '0', lon: '0', geometry: JSON.stringify({ type: 'LineString', coordinates: [[18, 59], [19, 60]] }) }]);
    const plainCsv = 'lat;lon;name\n59;18;"Ösmo\nquoted"\n';
    const extra = await importMapFilesToSqlite({ db, filePaths: [write('compact.csv', compact),
      write('legacy.csv.gz', gzipSync(plainCsv)), write('legacy.csv', plainCsv)] });
    assert.equal(extra.successfulCount, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM features').get().count, 2);
    const before = db.prepare('SELECT COUNT(*) AS count FROM datasets').get().count;
    const corrupt = await importMapFilesToSqlite({ db, filePaths: [write('broken.csv.gz', gzipSync(plainCsv).subarray(0, 10))] });
    assert.equal(corrupt.failedCount, 1);
    assert.match(corrupt.results[0].error, /gzip/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM datasets').get().count, before);
    const lineRows = [{ featureType: 'line', featureId: 'route', order: '2', lat: '60', lon: '19', color: '#ff0000', arrow: 'end' },
      { featureType: 'line', featureId: 'route', order: '1', lat: '59', lon: '18', color: '#ff0000', arrow: 'end' }];
    const legacyLine = await importMapFilesToSqlite({ db, filePaths: [write('line.csv', Papa.unparse(lineRows))] });
    assert.equal(legacyLine.successfulCount, 1);
    assert.equal(legacyLine.results[0].importedFeatureCount, 1);
    const preview = getSqlitePreviewFeature({ db, sourceRef: { datasetId: legacyLine.results[0].datasetId, rowIndex: 0 } });
    assert.deepEqual(preview.lines[0].coordinates, [[59, 18], [60, 19]]);
    assert.equal(preview.lines[0].arrow, 'end');
    assert.equal(preview.lines[0].style.color, '#ff0000');
    const canceled = await importMapFilesToSqlite({ db, filePaths: [filePaths[0]], shouldCancel: () => true });
    assert.equal(canceled.canceled, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM datasets').get().count, before + 1);
    let cancelBeforeCommit = false;
    const lateCanceled = await importMapFilesToSqlite({ db, filePaths: [filePaths[0]],
      shouldCancel: () => cancelBeforeCommit,
      onProgress: event => { if (event.state === 'storing') cancelBeforeCommit = true; },
    });
    assert.equal(lateCanceled.canceled, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM datasets').get().count, before + 1);
    // Native storage follows the same collision and styled-part export rules.
    const legacyRows = [];
    for (const [part, color, offset] of [['a', 'red', 0], ['b', 'blue', 1]]) {
      for (const [lat, lon] of [[59, 18], [59, 18.1], [59.1, 18]]) legacyRows.push({
        featureType: 'region', featureId: 'same', part, lat: lat + offset, lon, color,
      });
    }
    const styles = await importMapFilesToSqlite({ db, filePaths: [write('styles.csv', Papa.unparse(legacyRows))] });
    assert.equal(styles.successfulCount, 1);
    const roundtrip = exportDatasetGeojson(adapter, styles.results[0].datasetId);
    const again = await importMapFilesToSqlite({ db, filePaths: [write('styles.geojson', roundtrip.geojsonText)] });
    assert.equal(again.successfulCount, 1);
    assert.deepEqual(JSON.parse(exportDatasetGeojson(adapter, again.results[0].datasetId).geojsonText).features.map(part => part.properties.color), ['red', 'blue']);
    const collisionRows = [{ featureType: 'region', geometry: JSON.stringify(feature.geometry.geometries[2]) },
      ...[[60, 19], [60, 19.1], [60.1, 19]].map(([lat, lon]) => ({ featureType: 'region', featureId: 'geojson:0', part: '0', lat, lon }))];
    const collision = await importMapFilesToSqlite({ db, filePaths: [write('collision.csv', Papa.unparse({ fields: [...new Set(collisionRows.flatMap(Object.keys))], data: collisionRows }))] });
    assert.equal(collision.successfulCount, 1);
    const collisionId = collision.results[0].datasetId;
    assert.deepEqual(getSqliteLogicalZone({ db, datasetId: collisionId, featureId: 'geojson:0' }).parts[0].coordinates[0], [60, 19]);
    const canonicalZone = getSqliteLogicalZone({ db, datasetId: collisionId, featureId: 'geojson:0:1' });
    updateSqliteLogicalZone({ db, datasetId: collisionId, featureId: canonicalZone.featureId, parts: canonicalZone.parts });
    for (const compressed of [false, true]) {
      const foreign = { features: [feature, 42], type: 'Feature', properties: null, geometry: null };
      const contents = JSON.stringify(foreign);
      const imported = await importMapFilesToSqlite({ db, filePaths: [write(compressed ? 'foreign.geojson.gz' : 'foreign.geojson', compressed ? gzipSync(contents) : contents)] });
      assert.equal(imported.successfulCount, 1);
      assert.deepEqual(JSON.parse(exportDatasetGeojson(adapter, imported.results[0].datasetId).geojsonText).features, [foreign]);
    }
    console.log('Desktop incremental CSV/GeoJSON/gzip, typed export, holes, editing, errors, and cancellation passed.');
  } catch (error) {
    console.error('Original desktop import failure:', error);
    throw error;
  } finally {
    closeSqliteStore(db);
    // Remove only files this fixture created, with no recursive cleanup.
    for (const target of files) fs.unlinkSync(target);
    fs.rmdirSync(directory);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
