import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { readCsvTextChunks } from './csvTextStream.js';

/** Split decoded text at deliberately awkward boundaries without using files. */
async function* textChunks(text, size) {
  for (let index = 0; index < text.length; index += size) yield text.slice(index, index + size);
}

/** Collect small fixture records to compare with the existing whole-text parser. */
async function records(text, size, options) {
  const rows = [];
  for await (const result of readCsvTextChunks(textChunks(text, size), options)) rows.push(...result.data);
  return rows;
}

const configuration = { delimiter: '', skipEmptyLines: true, quoteChar: '"', escapeChar: '"' };
for (const fixture of [
  'lat,lon,name\r\n59,18,"Ösmo 🏰"\r\n60,19,"Two\nlines and ""quotes"""\r\n',
  'lat;lon;name\n59;18;"Two; fields"\n60;19;last',
  'lat\tlon\tname\n59\t18\tpoint\n',
  'lat,lon,name\n59,18\n\n60,19,name,extra\n',
  'lat,lon,name\n59,18,"unclosed',
  Array.from({ length: 10000 }, (_value, index) => `${index},18,"Quoted\ntext"`).join('\n'),
]) {
  const expected = Papa.parse(fixture, configuration).data;
  for (const size of [1, 7, 1024, 65536]) assert.deepEqual(await records(fixture, size), expected);
}
await assert.rejects(() => records('header\n"' + 'x'.repeat(100), 1, { maximumRecordCharacters: 30 }),
  error => error.code === 'csv-record-size-limit');
await assert.rejects(() => records('lat,lon\n59,18', 1, { shouldCancel: () => true }),
  error => error.code === 'import-canceled');
console.log('Streaming CSV delimiter, quoting, multiline, irregular-row parity, limits, and cancellation passed.');
