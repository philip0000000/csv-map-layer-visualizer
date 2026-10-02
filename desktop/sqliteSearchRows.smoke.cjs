'use strict';
const assert = require('node:assert/strict');
const { openSqliteStore, closeSqliteStore } = require('./sqliteStore.cjs');
const { getSqliteSearchRows } = require('./sqliteDatasetService.cjs');

/** Exercise indexed scans in both SQLite engines with enough rows to expose offset regressions. */
async function run() {
  const { default: initSqlJs } = await import('sql.js');
  const { createBrowserSqliteDatabase } = await import('../src/data/browserSqlite/browserSqliteDatabase.js');
  const { getBrowserSqliteSearchRows } = await import('../src/data/browserSqlite/browserSqliteDatasetQueries.js');
  const browser = createBrowserSqliteDatabase(await initSqlJs());
  const desktop = openSqliteStore(':memory:');
  try {
    for (const count of [100000, 200000]) {
      const id = `rows-${count}`;
      desktop.prepare(`INSERT INTO datasets (id, file_name, row_count, imported_feature_count,
        skipped_row_count, columns_json, imported_at) VALUES (?, ?, ?, 0, ?, '["name"]', '2026-01-01')`)
        .run(id, `${id}.csv`, count, count);
      browser.run(`INSERT INTO datasets (id, file_name, total_parsed_row_count, stored_row_count,
        columns_json, import_state, imported_at) VALUES (?, ?, ?, ?, '["name"]', 'complete', '2026-01-01')`,
      [id, `${id}.csv`, count, count]);
      // Gapped identities and duplicate values exercise migration and row-preserving matching.
      const insert = `WITH RECURSIVE sequence(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM sequence WHERE x < ${count - 1})
        INSERT INTO source_rows SELECT '${id}', x * 2,
        CASE WHEN x % 100 = 0 THEN '{"name":"match"}' ELSE '{"name":"other"}' END FROM sequence`;
      desktop.exec(insert);
      browser.run(insert);
      const checkedDesktop = { open: true, transaction: desktop.transaction.bind(desktop),
        prepare: (sql) => { assertNoOffsetOrCount(sql); return desktop.prepare(sql); } };
      const checkedBrowser = { prepare: (sql) => { assertNoOffsetOrCount(sql); return browser.prepare(sql); } };
      verify((query) => getSqliteSearchRows({ db: checkedDesktop, ...query }), id, count, 'desktop');
      verify((query) => getBrowserSqliteSearchRows(checkedBrowser, query), id, count, 'browser');
    }
  } finally { closeSqliteStore(desktop); browser.close(); }
}

/** Ensure production scans never regress to walking offsets or recounting the dataset. */
function assertNoOffsetOrCount(sql) {
  assert.doesNotMatch(sql, /\b(?:OFFSET|COUNT)\b/i);
}

/** Check complete coverage, match counts, end detection, and direct result-page retrieval. */
function verify(read, datasetId, count, backend) {
  const start = performance.now();
  let afterRowIndex = -1;
  let seen = 0;
  let matches = 0;
  let batches = 0;
  while (true) {
    const page = read({ datasetId, afterRowIndex });
    batches += 1;
    assert.ok(page.rows.length <= 200);
    for (let i = 0; i < page.rows.length; i += 1) {
      assert.equal(page.sourceRowIndices[i], seen * 2);
      seen += 1;
      if (page.rows[i].name === 'match') matches += 1;
    }
    if (!page.hasMore) break;
    assert.ok(page.sourceRowIndices.at(-1) > afterRowIndex);
    afterRowIndex = page.sourceRowIndices.at(-1);
  }
  assert.equal(seen, count);
  assert.equal(matches, count / 100);
  assert.equal(batches, count / 200);
  const rowIndices = Array.from({ length: 30 }, (_, i) => (i + 30) * 200);
  assert.deepEqual(read({ datasetId, rowIndices }).sourceRowIndices, rowIndices);
  assert.equal(read({ datasetId, afterRowIndex: count * 2 }).rows.length, 0);
  assert.throws(() => read({ datasetId, rowIndices: Array(31).fill(0) }));
  assert.throws(() => read({ datasetId, afterRowIndex: -2 }));
  console.log(`${backend}: ${count} rows, ${batches} batches, ${matches} matches in ${Math.round(performance.now() - start)} ms`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
