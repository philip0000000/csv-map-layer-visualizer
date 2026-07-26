import assert from 'node:assert/strict';
import {
  MAX_CSV_PARSE_WARNINGS,
  collectCsvParserWarnings,
  csvRowToObject,
  isCsvRowEmpty,
  normalizeCsvHeaders,
  pushCsvWarning,
  warnForExtraCsvCells,
} from './csvParsingCompatibility.js';

assert.deepEqual(
  normalizeCsvHeaders([' lat ', '', 'lon', 'lat', null, 'lat']),
  ['lat', 'lon', 'lat_2', 'lat_3'],
);
assert.deepEqual(normalizeCsvHeaders(null), []);

assert.equal(isCsvRowEmpty(['', '  ', null]), true);
assert.equal(isCsvRowEmpty(['', 'value']), false);
assert.equal(isCsvRowEmpty(''), false);

const headers = ['lat', 'lon', 'name'];
assert.deepEqual(csvRowToObject([' 1 ', 2], headers), {
  lat: '1',
  lon: '2',
  name: '',
});
assert.deepEqual(csvRowToObject(['1', '2', 'A', 'ignored'], headers), {
  lat: '1',
  lon: '2',
  name: 'A',
});

const warnings = [];
warnForExtraCsvCells(['1', '2', 'A', 'ignored'], headers, 7, warnings);
warnForExtraCsvCells(['1', '2'], headers, 8, warnings);
collectCsvParserWarnings(warnings, [
  { message: 'Unclosed quote', row: 4 },
  { message: 'Unknown row' },
]);
assert.deepEqual(warnings, [
  'Line 7: had 4 values; truncated to 3.',
  'Parser: Unclosed quote (row 4)',
  'Parser: Unknown row (row ?)',
]);

const cappedWarnings = [];
for (let index = 0; index < MAX_CSV_PARSE_WARNINGS + 5; index += 1) {
  pushCsvWarning(cappedWarnings, `Warning ${index}`);
}
assert.equal(cappedWarnings.length, MAX_CSV_PARSE_WARNINGS);
assert.equal(pushCsvWarning(cappedWarnings, 'Warning beyond the cap'), false);

console.log('CSV parsing compatibility smoke check passed.');
