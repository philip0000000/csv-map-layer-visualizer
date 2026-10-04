import assert from 'node:assert/strict';
import { GeojsonDocumentError, readGeojsonFeatures } from './geojsonStream.js';

/** Simulate file slices that split JSON keys, escaped strings, and numeric tokens. */
async function* chunks(text, size = 1) {
  for (let offset = 0; offset < text.length; offset += size) yield text.slice(offset, offset + size);
}

/** Collect results only in small tests; production callers should store bounded batches. */
async function collect(text, size, options) {
  const values = [];
  for await (const feature of readGeojsonFeatures(() => chunks(text, size), options)) values.push(feature);
  return values;
}

const feature = { type: 'Feature', id: 0, properties: {
  name: 'A "quoted"\\name\nwith é and 🏰', numeric: -1.23e-6, nullable: null, enabled: false,
}, geometry: { type: 'Point', coordinates: [18, 59, 123] } };
const document = { type: 'FeatureCollection', features: [feature, { ...feature, id: 'second' }],
  bbox: [18, 59, 19, 60], custom: { origin: 'test' } };
for (const size of [1, 2, 7, 64, 1024]) {
  let metadata;
  assert.deepEqual(await collect(JSON.stringify(document), size, {
    onMetadata: value => { metadata = value; },
  }), document.features);
  assert.deepEqual(metadata, { type: 'FeatureCollection', bbox: document.bbox, custom: document.custom });
  assert.deepEqual(await collect(JSON.stringify(feature), size), [feature]);
}
assert.deepEqual(await collect('\uFEFF' + JSON.stringify(document), 1), document.features);
assert.deepEqual(await collect('{"features":[],"type":"FeatureCollection"}', 1), []);

// The first feature is delivered before the reader asks the source for its suffix.
let suffixRead = false;
async function* incrementalSource() {
  yield '{"type":"FeatureCollection","features":[' + JSON.stringify(feature) + ',';
  suffixRead = true;
  yield JSON.stringify(feature) + ']}';
}
const reader = readGeojsonFeatures(incrementalSource());
assert.deepEqual((await reader.next()).value, feature);
assert.equal(suffixRead, false);
await reader.return();

for (const malformed of [
  '', '{} garbage', '{', '{"type":"FeatureCollection"}',
  '{"type":"FeatureCollection","features":null}',
  '{"type":"FeatureCollection","features":[],}',
  '{"type":"FeatureCollection","features":[1,]}',
  '{"type":"FeatureCollection","features":[],"features":[]}',
  '{"type" "Feature"}', '[1 2]', 'true',
  '{"name":"unterminated}', '{"number":01}', '{"number":1e999}',
  '{"name":"bad\\q"}', '{"a":NaN}', '{"a":undefined}',
]) await assert.rejects(() => collect(malformed, 1), GeojsonDocumentError);
await assert.rejects(() => collect(JSON.stringify(feature), 7, {
  maximumValueCharacters: 20,
}), GeojsonDocumentError);
await assert.rejects(() => collect(JSON.stringify(document), 1, {
  shouldCancel: () => true,
}), error => error.code === 'import-canceled');

// Collection size may exceed the per-feature limit without accumulating its items.
const many = { type: 'FeatureCollection', features: Array.from({ length: 100 }, () => feature) };
assert.equal((await collect(JSON.stringify(many), 64, { maximumValueCharacters: 512 })).length, 100);
console.log('Incremental GeoJSON syntax, feature delivery, metadata, limits, and cancellation passed.');

// Foreign members named features do not acquire collection semantics from key order.
for (const value of [
  { features: [feature, 42], type: 'Feature', properties: null, geometry: null },
  { type: 'Feature', features: [feature, 42], properties: null, geometry: null },
]) {
  assert.deepEqual(await collect(JSON.stringify(value), 1), [value]);
  const values = [];
  for await (const item of readGeojsonFeatures(chunks(JSON.stringify(value), 1))) values.push(item);
  assert.deepEqual(values, [value]);
}
const lateType = { features: many.features, type: 'FeatureCollection' };
assert.equal((await collect(JSON.stringify(lateType), 64, { maximumValueCharacters: 512 })).length, 100);
