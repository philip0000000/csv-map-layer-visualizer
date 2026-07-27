import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  getExampleNamesFromSearch,
} from './useExampleCsvFilesFromUrl.js';
import {
  getFirstImportedDatasetId,
  mergeImportBatchResults,
} from '../data/importBatchAggregation.js';

assert.deepEqual(
  getExampleNamesFromSearch(
    '?example=first.csv&example=present-day%2Fsecond.csv' +
    '&example=..%2Fsecret.csv&example=notes.txt&example=first.csv',
  ),
  ['first.csv', 'present-day/second.csv', 'first.csv'],
);

const mixedBatch = mergeImportBatchResults([
  {
    ok: false,
    results: [{ ok: false, fileName: 'broken.csv' }],
    error: { message: 'No CSV files were imported.' },
  },
  {
    ok: true,
    results: [{ ok: true, fileName: 'working.csv', datasetId: 'working' }],
  },
]);
assert.equal(mixedBatch.ok, true);
assert.equal(mixedBatch.successfulCount, 1);
assert.equal(mixedBatch.failedCount, 1);
assert.deepEqual(
  mixedBatch.results.map((result) => result.fileName),
  ['broken.csv', 'working.csv'],
);
assert.equal(mixedBatch.error, null);
assert.equal(getFirstImportedDatasetId(mixedBatch), 'working');

const failedBatch = mergeImportBatchResults([
  {
    ok: false,
    results: [{ ok: false, fileName: 'first.csv' }],
    error: { message: 'First failure.' },
  },
  {
    ok: false,
    results: [{ ok: false, fileName: 'second.csv' }],
    error: { message: 'Second failure.' },
  },
]);
assert.equal(failedBatch.ok, false);
assert.equal(failedBatch.failedCount, 2);
assert.equal(failedBatch.error.message, 'First failure.');
assert.equal(getFirstImportedDatasetId(failedBatch), null);

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
});
try {
  const { default: CsvPreviewTable } = await vite.ssrLoadModule(
    '/src/components/csv-panel/CsvPreviewTable.jsx',
  );
  const initialFailure = renderToStaticMarkup(React.createElement(
    CsvPreviewTable,
    {
      headers: ['name'],
      rows: [],
      totalRows: 0,
      hasMore: false,
      status: 'error',
      error: 'Could not load preview rows.',
    },
  ));
  assert.match(initialFailure, /role="alert"/);
  assert.match(initialFailure, /Could not load preview rows\./);
  assert.doesNotMatch(initialFailure, /No data rows detected\./);

  const laterFailure = renderToStaticMarkup(React.createElement(
    CsvPreviewTable,
    {
      headers: ['name'],
      rows: [{ name: 'Retained row' }],
      totalRows: 2,
      hasMore: true,
      status: 'loaded',
      error: 'Could not load more preview rows.',
      onShowMore() {},
    },
  ));
  assert.match(laterFailure, /Could not load more preview rows\./);
  assert.match(laterFailure, /Retained row/);
  assert.match(laterFailure, /Show 30 more/);
} finally {
  await vite.close();
}

console.log('Browser SQLite UI coordination smoke test passed.');
