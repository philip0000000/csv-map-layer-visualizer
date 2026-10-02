import { useEffect, useRef, useState } from 'react';
import CsvPreviewTable from './CsvPreviewTable';
import { startPreviewSearch, loadPreviewSearchPage } from '../../data/previewSearch.js';

/** Own explicit search actions and grouped pages without replacing normal Preview state. */
export default function PreviewSearch({ files, selected, dataSource, revision, onRowContextMenu, children }) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState('shown');
  const [state, setState] = useState({ status: 'idle', groups: [], error: null });
  const active = useRef(null);
  const generation = useRef(0);
  // Preview paging and timeline/viewport changes do not invalidate a search.
  const sourceKey = JSON.stringify([revision, scope === 'current' ? selected.id : null,
    files.map((f) => [f.id, f.headers, f.totalRows, scope === 'shown' ? f.enabled : null])]);

  useEffect(() => {
    generation.current += 1;
    active.current?.cancel();
    setState({ status: 'idle', groups: [], error: null });
    return () => { generation.current += 1; active.current?.cancel(); };
  }, [sourceKey]);

  /** Editing or cancelling discards results but retains the user's query. */
  function reset() {
    generation.current += 1;
    active.current?.cancel();
    active.current = null;
    setState({ status: 'idle', groups: [], error: null });
  }

  /** Dispatch the button's current action, also used by scoped Ctrl+Enter. */
  async function act() {
    if (state.status === 'running') { reset(); return; }
    if (state.status === 'results') { reset(); setText(''); return; }
    if (!text.trim()) { reset(); return; }
    const request = ++generation.current;
    active.current?.cancel();
    const scopedFiles = scope === 'current' ? [selected] : scope === 'shown' ? files.filter((f) => f.enabled) : files;
    const task = startPreviewSearch({ dataSource, files: scopedFiles, text });
    active.current = task;
    setState({ status: 'running', groups: [], error: null });
    try {
      const groups = await task.promise;
      if (generation.current !== request) return;
      setState({ status: groups ? 'results' : 'idle', groups: groups ?? [], error: null });
    } catch (error) {
      if (generation.current !== request || error.name === 'AbortError') return;
      setState({ status: 'idle', groups: [], error: error.message ?? 'Search failed.' });
    }
  }

  /** Append a group's next page only while its original search is still current. */
  async function more(group) {
    const request = generation.current;
    const update = (patch) => setState((current) => ({ ...current,
      groups: current.groups.map((g) => g.id === group.id ? { ...g, ...patch } : g) }));
    update({ loading: true, error: null });
    try {
      const rows = await loadPreviewSearchPage(dataSource, group);
      if (generation.current === request) update({ rows: [...group.rows, ...rows], loading: false });
    } catch (error) {
      if (generation.current === request) update({ loading: false, error: error.message ?? 'Could not load more rows.' });
    }
  }

  return <>
    <div className="csvPreviewTitle">Preview</div>
    <div className="csvPreviewSearchControls" onKeyDown={(event) => {
      if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); act(); }
    }}>
      <input className="csvSelect" aria-label="Search CSV values" placeholder="Search CSV values…"
        value={text} onChange={(event) => { reset(); setText(event.target.value); }} />
      <div className="csvPreviewSearchActions">
        <select className="csvSelect" aria-label="Search scope" value={scope}
          onChange={(event) => { reset(); setScope(event.target.value); }}>
          <option value="current">Current file</option><option value="shown">Shown files</option>
          <option value="all">All loaded files</option>
        </select>
        <button type="button" className="csvBtnPrimary" onClick={act}>
          {state.status === 'running' ? 'Cancel' : state.status === 'results' ? 'Clear search' : 'Search'}
        </button>
      </div>
      <details className="csvPreviewSearchHelp"><summary>Search help</summary>
        <p>Text matches part of a cell, ignoring case. Results always contain complete rows.</p>
        <ul>
          <li><code>Stockholm</code> — text in any column.</li>
          <li><code>name,country:Sweden</code> — either named column, using exact column names.</li>
          <li><code>/Stockholm/</code> — case-sensitive regex; <code>/stockholm/i</code> ignores case.</li>
          <li><code>name:/^Stockholm$/</code> — exact value; <code>name:/^$/</code> — empty cell.</li>
          <li><code>{String.raw`name:/^\s*$/`}</code> — empty or whitespace-only cell.</li>
          <li><code>/^[0-9]+$/</code> — digits only; <code>/^[A-Z]+$/</code> — uppercase ASCII letters.</li>
          <li><code>{String.raw`/^\p{Lu}+$/u`}</code> — Unicode uppercase letters, including Å, Ä, Ö.</li>
          <li><code>{'"test:test"'}</code> or <code>{'"/patterns/"'}</code> — literal text.</li>
          <li><code>{'"Place name",country:Sweden'}</code> — quote column names containing spaces or punctuation.</li>
        </ul>
        <p>Regex flags: <code>i</code>, <code>u</code>, or both. Escape a slash inside regex as <code>{String.raw`\/`}</code>.
          In quoted text, escape quotes as <code>{String.raw`\"`}</code> and backslashes as <code>{String.raw`\\`}</code>.</p>
        <p>Colons inside regex belong to the pattern. Unquoted <code>test:test</code> targets column <code>test</code>.
          Headers are not searched. Missing columns are skipped; numeric comparisons and combined conditions are not supported.</p>
        <p>Use Search or Ctrl+Enter in these controls. Cancel stops a running search; Clear search restores Preview.</p>
      </details>
    </div>
    {state.error && <div className="csvEmptyPreview" role="alert">{state.error}</div>}
    {state.status === 'running' && <div role="status" className="csvEmptyPreview">Searching…</div>}
    {state.status === 'results' ? <div aria-live="polite">
      <p>Search results — {state.groups.reduce((sum, g) => sum + g.totalRows, 0)} matching rows in {state.groups.length} files</p>
      {!state.groups.length && <div className="csvEmptyPreview">No matching rows</div>}
      {state.groups.map((group) => <details key={group.id} open className="csvPreviewSearchGroup">
        <summary>{group.name} — {group.totalRows} matching rows</summary>
        <CsvPreviewTable headers={group.headers} rows={group.rows} totalRows={group.totalRows}
          showTitle={false} hasMore={group.rows.length < group.totalRows}
          status={group.loading ? 'loading-more' : 'loaded'} error={group.error}
          onShowMore={() => more(group)} onDismissError={() => setState((s) => ({ ...s,
            groups: s.groups.map((g) => g.id === group.id ? { ...g, error: null } : g) }))}
          onRowContextMenu={(event, index) => onRowContextMenu?.(event, {
            datasetId: group.id, rowIndex: group.sourceRowIndices[index],
          })} />
      </details>)}
    </div> : children}
  </>;
}
