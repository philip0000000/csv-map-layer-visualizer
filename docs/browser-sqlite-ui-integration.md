# SQLite data-source architecture

GitHub Pages and every other browser build use temporary SQLite WASM as their
only CSV data backend. The Electron desktop build uses persistent native
SQLite. A page session creates exactly one backend and never mixes browser and
desktop data or switches to a fallback.

## Runtime selection and lifecycle

`selectRuntimeDataSource` owns the complete runtime decision:

```text
Electron renderer -> persistent desktop SQLite adapter
Browser renderer  -> temporary browser SQLite WASM adapter
```

`useRuntimeDataSource` creates the selected adapter once, initializes it before
imports are enabled, and disposes it when the page session ends. Disposing the
browser adapter closes and terminates its dedicated worker, which destroys the
temporary database.

Worker creation or SQLite initialization failure is shown in the CSV panel.
Imports remain unavailable, loading finishes with an error, and no second
backend is activated. Users should retry in a current browser or use the
desktop application.

## Browser storage and worker boundary

The browser database is a fresh `sql.js` in-memory database owned by one module
worker. The browser path does not create an OPFS or IndexedDB database and does
not write imported rows to local or session storage. Reloads, closed tabs,
worker restarts, and new tabs therefore start with empty dataset lists.

PapaParse and SQLite import work run inside the worker. CSV rows are inserted
incrementally in bounded batches. Complete datasets are not retained in React
state and are not returned after import. The worker sends complete rows only
for bounded preview pages, feature details, and grouped-result pages.

The protocol accepts fixed named operations and validated payloads. It never
accepts SQL, database handles, filesystem paths, or arbitrary worker messages.

## UI coordination

File-picker, drag-and-drop, and example imports all route through the selected
SQLite adapter. Progress and mixed per-file results are normalized before they
reach the panel. Dataset summaries contain metadata only. Preview pages contain
30 rows and preserve source-row order.

Selection, visibility, removal, and coordinate mapping changes invalidate the
affected summaries and map results. Mapping rebuilds are transactional, so a
failed rebuild leaves the previous mapping and features active.

Leaflet viewport queries include bounds, zoom, timeline state, enabled dataset
IDs, and a render budget of 1,000. Only the latest request generation may
update the map, preventing stale pan, zoom, or playback responses from
overwriting newer state. Exact and grouped points, lines, and regions return
compact render data; complete details are loaded on demand.

Grouped rows keep the immutable viewport, timeline, dataset, and grid context
captured by the originating query. Pages use a fixed size of 30 and stable
source ordering.

## Development and validation

Normal commands exercise the production browser backend; no migration mode or
backend environment flag exists:

```text
npm run dev
npm run build
npm run preview
```

Relevant automated validation includes:

```text
npm run lint
npm run build
npm run build:desktop

npm run smoke:runtime-data-source
npm run smoke:browser-sqlite-data-source
npm run smoke:browser-sqlite-ui
npm run smoke:browser-sqlite-points
npm run smoke:browser-sqlite-geometries
npm run validate:browser-sqlite-worker
npm run validate:desktop-large-file
```

Recorded browser versions, timings, counts, and the complete command matrix are
in [the issue #108 validation record](./issue-108-validation.md).

The supported large-file target is 30,000 rows. Manual browser validation must
also cover the development server, the production repository base path,
imports, viewport queries, details, dataset removal, and reload clearing data.
