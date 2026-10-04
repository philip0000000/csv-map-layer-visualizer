import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import initSqlJs from 'sql.js';
import { createBrowserSqliteDatabase } from './browserSqliteDatabase.js';
import { importBrowserSqliteCsvFile } from './browserSqliteImporter.js';
import { exportBrowserSqliteDatasetCsv } from './browserSqliteDatasetExport.js';
import { importBrowserSqliteCsvBatch } from './browserSqliteImportBatch.js';
import { normalizeImportBatchResult } from '../dataSourceNormalization.js';

const SQL = await initSqlJs();
const database = createBrowserSqliteDatabase(SQL);
const csv = 'lat;lon;name;year\n59;18;"Ösmo\nwith quotes ""here""";1300\n60;19;Second;1400\n';
const compressed = gzipSync(csv);

/** Build actual browser-compatible files without exposing their expanded text. */
function file(buffer, name = 'fixture.csv.gz') {
  const input = new File([buffer], name, { type: 'application/gzip' });
  input.text = () => { throw new Error('Whole-file text reads are forbidden.'); };
  return input;
}

try {
  const summary = await importBrowserSqliteCsvFile(database, file(compressed), {
    datasetId: 'gzip-success', chunkSizeBytes: 3, batchSize: 1,
  });
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.importedFeatureCount, 2);
  assert.equal(summary.storedBatchCount, 2);
  const exported = exportBrowserSqliteDatasetCsv(database, 'gzip-success');
  assert.equal(exported.fileName, 'fixture.csv');
  assert.match(exported.csvText, /Ösmo/);
  assert.match(exported.csvText, /1300/);

  // A corrupt trailer may be discovered after output; the file transaction still rolls back.
  for (const [datasetId, buffer] of [
    ['truncated', compressed.subarray(0, compressed.length - 4)],
    ['invalid', new TextEncoder().encode(csv)],
  ]) {
    await assert.rejects(() => importBrowserSqliteCsvFile(database, file(buffer), {
      datasetId, chunkSizeBytes: 3,
    }), error => error.code === 'gzip-read-failed');
    assert.equal(database.exec(`SELECT COUNT(*) FROM datasets WHERE id = '${datasetId}'`)[0].values[0][0], 0);
  }
  await assert.rejects(() => importBrowserSqliteCsvFile(database, file(compressed), {
    datasetId: 'canceled', shouldCancel: () => true,
  }), error => error.code === 'import-canceled');
  assert.equal(database.exec('SELECT COUNT(*) FROM datasets')[0].values[0][0], 1);
  const progress = [];
  const batch = normalizeImportBatchResult(await importBrowserSqliteCsvBatch(database,
    [file(compressed, 'good.csv.gz'), file(compressed.subarray(0, 10), 'bad.csv.gz')],
    { onProgress: event => progress.push(event) }));
  assert.equal(batch.successfulCount, 1);
  assert.equal(batch.failedCount, 1);
  assert.match(batch.results[1].error.message, /gzip.*corrupt/);
  assert.ok(progress.some(event => event.state === 'reading' && event.expandedBytes > 0));
  assert.equal(database.exec('SELECT COUNT(*) FROM datasets')[0].values[0][0], 2);
  console.log('Browser gzip CSV import, batches, metadata, rollback, and cancellation passed.');
} finally {
  database.close();
}
