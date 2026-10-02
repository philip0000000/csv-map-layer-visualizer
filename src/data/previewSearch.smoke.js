import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { parsePreviewSearch, createPreviewMatcher } from './previewSearchSyntax.js';
import { startPreviewSearch, loadPreviewSearchPage } from './previewSearch.js';

/** Run the production worker module in a real thread, with the browser messaging surface. */
function createWorker() {
  const url = new URL('./previewSearch.worker.js', import.meta.url).href;
  const thread = new Worker(`const { parentPort } = require('node:worker_threads');
    global.self = { postMessage: (data) => parentPort.postMessage(data) };
    import(${JSON.stringify(url)}).then(() => parentPort.on('message', (data) => self.onmessage({ data })));`, { eval: true });
  const wrapper = { postMessage: (data) => thread.postMessage(data), terminate: () => thread.terminate() };
  thread.on('message', (data) => wrapper.onmessage?.({ data }));
  thread.on('error', (error) => wrapper.onerror?.(error));
  return wrapper;
}

for (const [query, row, expected] of [
  ['Stockholm', { name: 'STOCKHOLM' }, true],
  ['/Stockholm/', { name: 'STOCKHOLM' }, false],
  ['/stockholm/i', { name: 'STOCKHOLM' }, true],
  ['name,country:Sweden', { country: 'Sweden' }, true],
  ['name:/^test:test$/', { name: 'test:test' }, true],
  ['"test:test"', { name: 'test:test' }, true],
  ['"/patterns/"', { name: '/patterns/' }, true],
  ['"Place name":Sweden', { 'Place name': 'Sweden' }, true],
  [String.raw`"a\"b\\c"`, { name: 'a"b\\c' }, true],
  [String.raw`/a\/b/`, { name: 'a/b' }, true],
  [String.raw`/^\p{Lu}+$/u`, { name: 'ÅÄÖ' }, true],
  ['name:/^$/', { name: '' }, true],
  ['name:/^$/', { country: '' }, false],
  ['/AB/', { name: 'A', country: 'B' }, false],
  ['name', { name: 'other' }, false],
]) {
  const parsed = parsePreviewSearch(query);
  const columns = Object.keys(row).filter((key) => !parsed.columns || parsed.columns.includes(key));
  assert.equal(createPreviewMatcher(parsed)(row, columns), expected, query);
}
for (const invalid of ['"unclosed', 'name,:x', 'name:', '/missing', '/x/g', '/x/ii', 'Place name:x', 'name:"x"junk']) {
  assert.throws(() => parsePreviewSearch(invalid), undefined, invalid);
}
assert.equal(parsePreviewSearch('  '), null);

const files = [{ id: 'a', name: 'a.csv', headers: ['name'], enabled: true },
  { id: 'b', name: 'b.csv', headers: ['country'], enabled: false }];
const rows = { a: Array.from({ length: 265 }, (_, i) => ({ name: i % 2 ? 'Sweden' : 'Other' })), b: [{ country: 'Sweden' }] };
const dataSource = {
  /** Supply bounded pages with deliberately gapped source identities. */
  async getSearchRows({ datasetId, afterRowIndex = -1, rowIndices }) {
    if (rowIndices) {
      assert.ok(rowIndices.length <= 30);
      return { rows: rowIndices.map((id) => rows[datasetId][id / 2]), sourceRowIndices: rowIndices, hasMore: false };
    }
    const offset = Math.floor(afterRowIndex / 2) + 1;
    const page = rows[datasetId].slice(offset, offset + 200);
    return { rows: page, sourceRowIndices: page.map((_, i) => (offset + i) * 2),
      hasMore: offset + page.length < rows[datasetId].length };
  },
};
const run = (text, scoped = files) => startPreviewSearch({ dataSource, files: scoped, text, createWorker });
const groups = await run('name,country:Sweden').promise;
assert.deepEqual(groups.map((g) => g.totalRows), [132, 1]);
assert.equal(groups[0].rows.length, 30);
assert.deepEqual(groups[0].sourceRowIndices.slice(0, 3), [2, 6, 10]);
assert.equal((await loadPreviewSearchPage(dataSource, groups[0])).length, 30);
assert.equal((await run('Sweden', files.slice(0, 1)).promise).length, 1);
assert.equal((await run('Missing').promise).length, 0);
await assert.rejects(run('unknown:x').promise, /None of the requested columns/);
await assert.rejects(run('/[/').promise, /regular expression/i);

// A pathological pattern must not block Cancel or damage a subsequent search.
const slow = startPreviewSearch({ files: [files[0]], text: '/^(a+)+$/', createWorker,
  dataSource: { getSearchRows: async () => ({ rows: [{ name: 'a'.repeat(100) + '!' }], sourceRowIndices: [0], hasMore: false }) } });
setTimeout(() => slow.cancel(), 150);
await assert.rejects(slow.promise, { name: 'AbortError' });
assert.equal((await run('Sweden').promise).length, 2);
// Measure the shared scan and real regex worker separately from backend SQL timing.
rows.a = Array.from({ length: 200000 }, (_, i) => ({ name: i % 2 ? 'Sweden' : 'Other' }));
let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 10);
const started = performance.now();
try {
  const large = await run('/sweden/i', files.slice(0, 1)).promise;
  assert.equal(large[0].totalRows, 100000);
  assert.equal(large[0].rows.length, 30);
  assert.equal(large[0].sourceRowIndices.at(-1), 399998);
  assert.ok(ticks > 0, 'The main event loop must remain responsive during the scan');
  assert.equal((await loadPreviewSearchPage(dataSource, large[0])).length, 30);
  console.log(`Search and regex worker: 200000 rows in ${Math.round(performance.now() - started)} ms; ${ticks} event-loop ticks`);
} finally { clearInterval(timer); }
console.log('Preview search syntax, bounded paging, source identities, and regex cancellation passed.');
