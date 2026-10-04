import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import initSqlJs from 'sql.js';
import Papa from 'papaparse';
import { createBrowserSqliteDatabase } from './browserSqliteDatabase.js';
import { importBrowserSqliteCsvFile } from './browserSqliteImporter.js';
import { queryBrowserSqliteMapView } from './browserSqlitePointQueries.js';
import { getBrowserSqliteFeatureDetails } from './browserSqlitePointDetails.js';
import { getBrowserSqliteLogicalZone, updateBrowserSqliteLogicalZone } from './browserSqliteZoneAdjustments.js';
import { normalizeFeatureDetailsResult, normalizeMapViewResult } from '../dataSourceNormalization.js';
import { exportDatasetGeojson } from '../geojsonExport.js';
import { exportBrowserSqliteDatasetCsv } from './browserSqliteDatasetExport.js';
import { transformZoneParts } from '../../components/zoneTransform.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);
const outer = [[18, 59, 10], [19, 59, 11], [19, 60, 12], [18, 59, 10]];
const hole = [[18.2, 59.1, 1], [18.3, 59.1, 2], [18.3, 59.2, 3], [18.2, 59.1, 1]];
const feature = { type: 'Feature', id: 0, properties: { name: 'Mixed', year: 1300, color: '#ff0000',
  nested: { array: [1, false, null] } }, geometry: { type: 'GeometryCollection', geometries: [
    { type: 'MultiPoint', coordinates: [[18, 59], [19, 60]] },
    { type: 'LineString', coordinates: [[18, 59], [19, 60]] },
    { type: 'Polygon', coordinates: [outer, hole] },
  ] } };
const document = { type: 'FeatureCollection', custom: { origin: 'fixture' }, bbox: [18, 59, 19, 60], features: [feature,
  { type: 'Feature', id: 0, properties: null, geometry: null },
  { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [999, 59] } },
] };
const query = { bounds: { south: 50, north: 70, west: 10, east: 30 }, renderBudget: 1000 };
try {
  for (const compressed of [false, true]) {
    const datasetId = compressed ? 'compressed' : 'plain';
    const text = JSON.stringify(document);
    const input = new File([compressed ? gzipSync(text) : text], compressed ? 'fixture.geojson.gz' : 'fixture.geojson');
    const result = await importBrowserSqliteCsvFile(database, input, { datasetId, chunkSizeBytes: 7 });
    assert.equal(result.rowCount, 2);
    assert.equal(result.skippedRowCount, 1);
    assert.equal(result.importedFeatureCount, 4);
    assert.equal(result.warnings.length, 1);
    const map = normalizeMapViewResult(queryBrowserSqliteMapView(database, { ...query, datasetIds: [datasetId] }));
    assert.equal(map.points.length, 2);
    assert.equal(map.lines.length, 1);
    assert.equal(map.regions.length, 1);
    assert.equal(map.regions[0].coordinates.length, 2);
    assert.equal(map.regions[0].style.color, '#ff0000');
    const details = getBrowserSqliteFeatureDetails(database, { sourceRef: { datasetId, rowIndex: 0 } });
    assert.deepEqual(details.row.nested, feature.properties.nested);
    assert.deepEqual(normalizeFeatureDetailsResult(details).row, feature.properties);
    assert.equal(details.row.year, 1300);
    const exported = JSON.parse(exportDatasetGeojson(database, datasetId).geojsonText);
    assert.deepEqual(exported.features, document.features.slice(0, 2));
    assert.deepEqual(exported.custom, document.custom);
    assert.deepEqual(exported.bbox, document.bbox);
    assert.equal(details.sourceFeatureId, 0);
    const csvExport = Papa.parse(exportBrowserSqliteDatasetCsv(database, datasetId).csvText, { header: true });
    assert.deepEqual(JSON.parse(csvExport.data[0].nested), feature.properties.nested);
    assert.deepEqual(JSON.parse(csvExport.data[0].geometry).properties, feature.properties);
    assert.equal(queryBrowserSqliteMapView(database, { ...query, datasetIds: [datasetId],
      timeline: { timelineEnabled: true, startYear: 1500, endYear: 1600 } }).regions.length, 0);
  }

  const zone = getBrowserSqliteLogicalZone(database, { datasetId: 'plain', featureId: 'geojson:0' });
  const moved = transformZoneParts(zone.parts, { operation: 'move', center: { lat: 59, lng: 18 },
    start: { lat: 59, lng: 18 }, current: { lat: 59.1, lng: 18.1 } });
  assert.equal(moved[0].coordinates.length, 2);
  updateBrowserSqliteLogicalZone(database, { datasetId: 'plain', featureId: 'geojson:0', parts: moved });
  const edited = JSON.parse(exportDatasetGeojson(database, 'plain').geojsonText).features[0];
  assert.deepEqual(edited.geometry.geometries[0], feature.geometry.geometries[0]);
  assert.deepEqual(edited.geometry.geometries[1], feature.geometry.geometries[1]);
  assert.equal(edited.geometry.geometries[2].coordinates[0][0][2], 10);
  assert.notDeepEqual(edited.geometry.geometries[2], feature.geometry.geometries[2]);
  assert.deepEqual(edited.properties, feature.properties);

  const compact = { type: 'Feature', properties: { color: '#00ff00', year: 'invalid', nested: [1, 2] },
    geometry: { type: 'LineString', coordinates: [[18, 59], [19, 60]] } };
  const csv = Papa.unparse([{ lat: '0', lon: '0', color: '#ff0000', year: '1400', geometry: JSON.stringify(compact) },
    { lat: '59', lon: '18', geometry: 'ordinary custom metadata' },
    { lat: '59', lon: '18', geometry: '{"type":"Polygon","coordinates":' }]);
  const summary = await importBrowserSqliteCsvFile(database, new File([gzipSync(csv)], 'compact.csv.gz'), { datasetId: 'compact' });
  assert.equal(summary.skippedRowCount, 1);
  const map = queryBrowserSqliteMapView(database, { ...query, datasetIds: ['compact'] });
  assert.equal(map.lines[0].style.color, '#00ff00');
  assert.equal(map.lines[0].timelineExtent.startYear, 1400);
  assert.equal(map.points.length, 1);
  assert.ok(normalizeMapViewResult(queryBrowserSqliteMapView(database, { ...query, datasetIds: ['plain'] })).points[0].featureId);
  assert.deepEqual(getBrowserSqliteFeatureDetails(database, { sourceRef: { datasetId: 'compact', rowIndex: 0 } }).row.nested, [1, 2]);

  // All multipart variants reach the map, not just the low-level validator.
  const multipart = { type: 'Feature', id: 'multipart', properties: { geometryInterpretation: 'custom', geometry: { source: true } },
    geometry: { type: 'GeometryCollection', geometries: [
      { type: 'MultiLineString', coordinates: [[[18, 59], [19, 60]], [[20, 60], [21, 61]]] },
      { type: 'MultiPolygon', coordinates: [[outer, hole], [outer]] },
      { type: 'Point', coordinates: [18, 59, 100] },
    ] } };
  await importBrowserSqliteCsvFile(database, new File([JSON.stringify(multipart)], 'multipart.geojson'), { datasetId: 'multipart' });
  const multiMap = queryBrowserSqliteMapView(database, { ...query, datasetIds: ['multipart'] });
  assert.equal(multiMap.lines.length, 2);
  assert.equal(multiMap.regions.length, 2);
  assert.equal(multiMap.points.length, 1);
  assert.deepEqual(JSON.parse(exportDatasetGeojson(database, 'multipart').geojsonText).features[0], multipart);
  const atypical = { type: 'Feature', properties: { color: { custom: true }, name: false, image: [], year: null },
    bbox: [17, 58, 20, 61], geometry: { type: 'Point', coordinates: [18, 59] } };
  await importBrowserSqliteCsvFile(database, new File([JSON.stringify(atypical)], 'typed.geojson'), { datasetId: 'typed' });
  assert.deepEqual(getBrowserSqliteFeatureDetails(database, { sourceRef: { datasetId: 'typed', rowIndex: 0 } }).row, atypical.properties);
  assert.deepEqual(normalizeFeatureDetailsResult(getBrowserSqliteFeatureDetails(database,
    { sourceRef: { datasetId: 'typed', rowIndex: 0 } })).row, atypical.properties);
  assert.deepEqual(JSON.parse(exportDatasetGeojson(database, 'typed').geojsonText).features[0], atypical);
  const limited = queryBrowserSqliteMapView(database, { ...query, datasetIds: ['multipart'], renderBudget: 1 });
  assert.equal(limited.lines.length + limited.regions.length, 1);
  assert.equal(limited.stats.hiddenGeometryCount, 3);
  assert.equal(queryBrowserSqliteMapView(database, { ...query, bounds: { south: -90, north: 90, west: -540, east: 540 },
    datasetIds: ['multipart'] }).regions.length, 2);
  await importBrowserSqliteCsvFile(database, new File(['{"type":"FeatureCollection","features":[]}'], 'empty.geojson'), { datasetId: 'empty' });
  assert.deepEqual(JSON.parse(exportDatasetGeojson(database, 'empty').geojsonText).features, []);
  let canceled = false;
  await assert.rejects(() => importBrowserSqliteCsvFile(database, new File([JSON.stringify(multipart)], 'cancel.geojson'), {
    datasetId: 'late-cancel', shouldCancel: () => canceled,
    onProgress: progress => { if (progress.phase === 'storing') canceled = true; },
  }), error => error.code === 'csv-import-canceled');
  assert.equal(database.exec("SELECT COUNT(*) FROM datasets WHERE id = 'late-cancel'")[0].values[0][0], 0);
  // Legacy per-part styles and ordered line metadata survive export and reimport.
  const legacyRows = [];
  for (const [part, color, offset] of [['a', 'red', 0], ['b', 'blue', 1]]) {
    for (const [lat, lon] of [[59, 18], [59, 18.1], [59.1, 18]]) legacyRows.push({
      featureType: 'region', featureId: 'same', part, lat: lat + offset, lon, color,
    });
  }
  legacyRows.push(
    { featureType: 'line', featureId: 'ordered', order: 2, lat: 60, lon: 19, color: 'red', year: 1500 },
    { featureType: 'line', featureId: 'ordered', order: 1, lat: 59, lon: 18, color: 'blue', year: 1400 });
  await importBrowserSqliteCsvFile(database, new File([gzipSync(Papa.unparse({ fields: [...new Set(legacyRows.flatMap(Object.keys))], data: legacyRows }))], 'styles.csv.gz'), { datasetId: 'styles' });
  const roundtrip = exportDatasetGeojson(database, 'styles');
  await importBrowserSqliteCsvFile(database, new File([roundtrip.geojsonText], 'styles.geojson'), { datasetId: 'styles-again' });
  for (const datasetId of ['styles', 'styles-again']) {
    const result = queryBrowserSqliteMapView(database, { ...query, datasetIds: [datasetId] });
    assert.deepEqual(result.regions.map(part => part.style.color), ['red', 'blue']);
    assert.equal(result.lines[0].style.color, 'blue');
    assert.equal(result.lines[0].timelineExtent.startYear, 1400);
  }
  const colliding = [{ featureType: 'region', geometry: JSON.stringify({ type: 'Polygon', coordinates: [outer] }) },
    ...[[60, 19], [60, 19.1], [60.1, 19]].map(([lat, lon]) => ({ featureType: 'region', featureId: 'geojson:0', part: '0', lat, lon }))];
  await importBrowserSqliteCsvFile(database, new File([gzipSync(Papa.unparse({ fields: [...new Set(colliding.flatMap(Object.keys))], data: colliding }))], 'collision.csv.gz'), { datasetId: 'collision' });
  const collisionMap = normalizeMapViewResult(queryBrowserSqliteMapView(database, { ...query, datasetIds: ['collision'] }));
  assert.equal(new Set(collisionMap.regions.map(part => part.id)).size, 2);
  const canonical = collisionMap.regions.find(part => part.geojsonComponent);
  assert.equal(canonical.featureId, 'geojson:0:1');
  const originalZone = getBrowserSqliteLogicalZone(database, { datasetId: 'collision', featureId: 'geojson:0' });
  assert.deepEqual(originalZone.parts[0].coordinates[0], [60, 19]);
  updateBrowserSqliteLogicalZone(database, { datasetId: 'collision', featureId: 'geojson:0', parts: originalZone.parts });
  assert.deepEqual(getBrowserSqliteLogicalZone(database, { datasetId: 'collision', featureId: canonical.featureId }).parts[0].coordinates[0][0], [59, 18]);
  for (const compressed of [false, true]) {
    const foreign = { features: [feature, 42], type: 'Feature', properties: null, geometry: null };
    const contents = JSON.stringify(foreign);
    const id = `foreign-${compressed}`;
    const imported = await importBrowserSqliteCsvFile(database, new File([compressed ? gzipSync(contents) : contents], compressed ? 'foreign.geojson.gz' : 'foreign.geojson'), { datasetId: id });
    assert.equal(imported.skippedRowCount, 0);
    assert.deepEqual(JSON.parse(exportDatasetGeojson(database, id).geojsonText).features, [foreign]);
  }
  console.log('Browser native/compact GeoJSON, holes, typed export, precedence, editing, and compatibility passed.');
} finally { database.close(); }
