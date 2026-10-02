import { parsePreviewSearch } from './previewSearchSyntax.js';

/** Seek bounded source batches and retain only matching identities and the first result page. */
export function startPreviewSearch({ dataSource, files, text, createWorker = () =>
  new Worker(new URL('./previewSearch.worker.js', import.meta.url), { type: 'module' }) }) {
  let worker;
  let cancelled = false;
  let rejectPending;
  const abort = () => new DOMException('Search cancelled.', 'AbortError');
  /** Interrupt even a regex stuck inside one cell, without touching the database. */
  function cancel() {
    cancelled = true;
    worker?.terminate();
    rejectPending?.(abort());
  }
  /** Allow only one bounded page in flight; an ended search never requests another. */
  function evaluate(payload) {
    if (cancelled) return Promise.reject(abort());
    return new Promise((resolve, reject) => {
      rejectPending = reject;
      worker.onmessage = ({ data }) => {
        rejectPending = null;
        if (data.error) reject(new Error(data.error));
        else resolve(data.indices);
      };
      worker.onerror = () => reject(new Error('Search worker failed. Please try again.'));
      worker.postMessage(payload);
    });
  }
  const promise = (async () => {
    const query = parsePreviewSearch(text);
    if (!query) return null;
    if (query.columns && !files.some((file) => file.headers.some((h) => query.columns.includes(h)))) {
      throw new Error('None of the requested columns exists in the selected search scope.');
    }
    worker = createWorker();
    try {
      await evaluate({ query });
      const groups = [];
      for (const file of files) {
        const columns = query.columns ? file.headers.filter((h) => query.columns.includes(h)) : file.headers;
        if (!columns.length) continue;
        const group = { id: file.id, name: file.name, headers: file.headers,
          sourceRowIndices: [], rows: [], totalRows: 0 };
        let afterRowIndex = -1;
        while (true) {
          if (cancelled) throw abort();
          const page = await dataSource.getSearchRows({ datasetId: file.id, afterRowIndex });
          if (cancelled) throw abort();
          if (page.rows.length && page.sourceRowIndices[0] <= afterRowIndex) {
            throw new Error('Search received a non-advancing source batch.');
          }
          const indices = await evaluate({ rows: page.rows, columns });
          for (const index of indices) {
            group.sourceRowIndices.push(page.sourceRowIndices[index]);
            if (group.rows.length < 30) group.rows.push(page.rows[index]);
          }
          afterRowIndex = page.sourceRowIndices.at(-1) ?? afterRowIndex;
          if (!page.hasMore) break;
          if (!page.rows.length) throw new Error('Search received an incomplete source page.');
        }
        group.totalRows = group.sourceRowIndices.length;
        if (group.totalRows) groups.push(group);
      }
      return groups;
    } finally {
      worker?.terminate();
      rejectPending = null;
    }
  })();
  return { promise, cancel };
}

/** Fetch at most 30 matching identities directly, preserving migrated gaps and source order. */
export async function loadPreviewSearchPage(dataSource, group) {
  const wanted = group.sourceRowIndices.slice(group.rows.length, group.rows.length + 30);
  if (!wanted.length) return [];
  const page = await dataSource.getSearchRows({ datasetId: group.id, rowIndices: wanted });
  if (page.rows.length !== wanted.length || page.sourceRowIndices.some((id, index) => id !== wanted[index])) {
    throw new Error('Source data changed. Run the search again.');
  }
  return page.rows;
}
