import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { getDatasetExportFileName, getImportFileFormat } from './importFileFormats.js';
import { readImportTextChunks } from './importTextStream.js';
import { readGeojsonFeatures } from './geojsonStream.js';

/** Split bytes deliberately inside gzip headers and multibyte UTF-8 characters. */
async function* bytes(buffer, chunkSize = 1) {
  for (let offset = 0; offset < buffer.length; offset += chunkSize) yield buffer.subarray(offset, offset + chunkSize);
}

/** Collect only small fixture text; production importers must consume incrementally. */
async function text(buffer, options) {
  let result = '';
  for await (const chunk of readImportTextChunks(bytes(buffer), options)) result += chunk;
  return result;
}

assert.deepEqual(getImportFileFormat('example.CSV.GZ'), { format: 'csv', compressed: true });
assert.deepEqual(getImportFileFormat('example.geojson'), { format: 'geojson', compressed: false });
for (const name of ['example.gz', 'example.csv.zip', 'example.json', 'example.csv.exe']) {
  assert.equal(getImportFileFormat(name), null);
}
assert.equal(getDatasetExportFileName('example.csv.gz', 'geojson'), 'example.geojson');
assert.equal(getDatasetExportFileName('example.geojson.gz', 'csv'), 'example.csv');

const csv = 'lat,lon,name\n59,18,"Ösmo 🏰"\n';
const encoded = new TextEncoder().encode(csv);
const compressed = gzipSync(encoded);
let progress;
assert.equal(await text(encoded, { fileName: 'test.csv' }), csv);
assert.equal(await text(compressed, { fileName: 'test.csv.gz',
  onProgress: value => { progress = value; },
}), csv);
assert.deepEqual(progress, { sourceBytes: compressed.length, expandedBytes: encoded.length, complete: true });
assert.equal(await text(encoded, { fileName: 'test.csv', maximumExpandedBytes: encoded.length }), csv);
await assert.rejects(() => text(compressed, { fileName: 'test.csv.gz', maximumExpandedBytes: 4 }),
  error => error.code === 'import-size-limit');
await assert.rejects(() => text(compressed, { fileName: 'test.csv.gz', shouldCancel: () => true }),
  error => error.code === 'import-canceled');

const corrupted = compressed.slice();
corrupted[corrupted.length - 8] ^= 0xff;
for (const buffer of [compressed.subarray(0, compressed.length - 4), corrupted, encoded]) {
  await assert.rejects(() => text(buffer, { fileName: 'test.csv.gz' }),
    error => error.code === 'gzip-read-failed');
}
await assert.rejects(() => text(new Uint8Array([0xff]), { fileName: 'test.geojson' }),
  error => error.code === 'file-read-failed');

const feature = { type: 'Feature', properties: { name: 'Ösmo 🏰' },
  geometry: { type: 'Point', coordinates: [18, 59] } };
const geojson = gzipSync(JSON.stringify({ type: 'FeatureCollection', features: [feature] }));
const values = [];
for await (const value of readGeojsonFeatures(readImportTextChunks(bytes(geojson), { fileName: 'test.geojson.gz' }))) {
  values.push(value);
}
assert.deepEqual(values, [feature]);

// Closing the text generator must release the underlying file iterator.
let closed = false;
async function* openSource() {
  try { while (true) yield encoded; } finally { closed = true; }
}
const reader = readImportTextChunks(openSource(), { fileName: 'test.csv' });
await reader.next();
await reader.return();
assert.equal(closed, true);
console.log('Gzip/plain parity, UTF-8 boundaries, corruption, limits, progress, and source cleanup passed.');
