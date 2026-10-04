import assert from 'node:assert/strict';
import {
  classifyCsvGeometry,
  getGeojsonComponents,
  GeojsonValidationError,
  normalizeGeojsonFeature,
} from './geojson.js';

const outer = [[18, 59], [19, 59], [19, 60], [18, 59]];
const hole = [[18.2, 59.1], [18.3, 59.1], [18.3, 59.2], [18.2, 59.1]];
const source = {
  type: 'Feature', id: 0, properties: {
    name: 'Mixed', enabled: false, count: 12, missing: null,
    nested: { values: [1, '2', null] },
  },
  geometry: { type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [18, 59, 123] },
    { type: 'MultiPoint', coordinates: [[19, 60], [20, 61]] },
    { type: 'LineString', coordinates: [[18, 59], [19, 60]] },
    { type: 'MultiLineString', coordinates: [[[18, 59], [19, 60]]] },
    { type: 'Polygon', coordinates: [outer, hole] },
    { type: 'MultiPolygon', coordinates: [[outer, hole], [outer]] },
  ] },
  bbox: [18, 59, 20, 61], custom: { retained: true },
};
const feature = normalizeGeojsonFeature(source);
assert.deepEqual(feature, source);
assert.notEqual(feature, source);
const parts = getGeojsonComponents(feature);
assert.equal(parts.length, 8);
assert.deepEqual(parts[0], { kind: 'point', path: ['geometries', 0, 'coordinates'], coordinates: [59, 18] });
assert.deepEqual(parts[5].coordinates, [outer, hole].map(ring => ring.map(([lon, lat]) => [lat, lon])));
assert.deepEqual(parts[6].path, ['geometries', 5, 'coordinates', 0]);
assert.equal(feature.geometry.geometries[0].coordinates[2], 123);
feature.properties.nested.values.push(3);
assert.equal(source.properties.nested.values.length, 3);

for (const value of ['', 'ordinary metadata', '{"type":"business"}', 'not JSON']) {
  assert.equal(classifyCsvGeometry(value).kind, 'legacy');
}
assert.equal(classifyCsvGeometry(JSON.stringify(source)).kind, 'geojson');
assert.equal(classifyCsvGeometry('{"type":"Polygon","coordinates":').kind, 'invalid');
assert.equal(classifyCsvGeometry('{"type":"Polygon","coordinates":', 'legacy').kind, 'legacy');
assert.equal(classifyCsvGeometry('ordinary metadata', 'geojson').kind, 'invalid');
assert.throws(() => classifyCsvGeometry('', 'invalid'), TypeError);
assert.deepEqual(normalizeGeojsonFeature({ type: 'Feature', properties: null, geometry: null }), {
  type: 'Feature', properties: null, geometry: null,
});

for (const geometry of [
  { type: 'Point', coordinates: [181, 59] },
  { type: 'Point', coordinates: [18, 91] },
  { type: 'Point', coordinates: ['18', 59] },
  { type: 'Point', coordinates: [18, 59, Infinity] },
  { type: 'LineString', coordinates: [[18, 59]] },
  { type: 'Polygon', coordinates: [[[18, 59], [19, 59], [19, 60], [20, 60]]] },
  { type: 'GeometryCollection', geometries: [null] },
]) assert.throws(() => normalizeGeojsonFeature(geometry), GeojsonValidationError);
assert.throws(() => normalizeGeojsonFeature({ type: 'Feature', properties: {} }), GeojsonValidationError);
assert.throws(() => normalizeGeojsonFeature({ ...source, id: true }), GeojsonValidationError);
assert.throws(() => normalizeGeojsonFeature({ ...source, bbox: [1, 2, 3] }), GeojsonValidationError);

// A valid object with a dangerous-looking property name must remain ordinary data.
const specialProperties = JSON.parse('{"__proto__":{"polluted":true},"constructor":"metadata"}');
const special = normalizeGeojsonFeature({ type: 'Feature', geometry: null, properties: specialProperties });
assert.equal(Object.hasOwn(special.properties, '__proto__'), true);
assert.equal({}.polluted, undefined);

console.log('GeoJSON validation, component identity, holes, and property preservation passed.');
