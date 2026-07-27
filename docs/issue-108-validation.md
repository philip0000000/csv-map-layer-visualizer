# Issue #108 validation record

Validation date: 2026-07-27

## Environment

- Operating system: Windows
- Node.js: 24.11.1
- npm: 11.6.2
- Chrome: 150.0.7871.182
- Firefox: Developer Edition 144.0, portable installation
- Manual fixture: 30,000 data rows, 655,709 bytes
- Desktop automated fixture: 30,000 data rows, 2,029,375 bytes

Browser timing and memory figures vary between machines. The validation uses
responsiveness, progress, bounded render results, and correct results as the
functional requirements rather than machine-specific timing thresholds.

## Manual browser validation

The temporary SQLite browser path passed the development-mode checklist in
Chrome and Firefox before the raw backend was removed. The final production
build then passed the same browsers at the configured repository URL:

```text
http://127.0.0.1:4173/csv-map-layer-visualizer/
```

The targeted manual smoke checks covered:

- application and SQLite initialization;
- file-picker and drag-and-drop imports;
- points, lines, regions, and feature details;
- dataset selection, visibility, mapping, and removal;
- import progress and a final 30,000-row count;
- viewport pan and zoom responsiveness;
- bounded grouped results and multiple detail pages;
- timeline filtering and playback;
- removal of the selected and final datasets;
- reload clearing browser imports; and
- a separate tab starting with an empty database.

This was a practical release smoke pass, not an exhaustive cross-browser
matrix of every example URL, style, timeline edge case, responsive layout, and
failure path. Broader repeatable browser regression coverage is deferred to a
standalone follow-up issue.

The production `dist/index.html` referenced assets through
`/csv-map-layer-visualizer/`. The output contained both the module worker and
`sql-wasm-browser` WASM asset.

An actual GitHub Pages smoke test remains a post-deployment step because this
branch was intentionally not pushed or deployed during local validation.

## Browser 30,000-row automated validation

Command:

```text
npm run validate:browser-sqlite-worker
```

Result: pass

- Import duration: 610 ms
- Total validation duration: 1,583 ms
- Stored rows: 30,000
- Progress events: 5
- Import heartbeat callbacks: 155
- Query heartbeat callbacks: 138
- Exact viewport render items: 23
- Dense viewport render items: 32
- Sparse viewport render items: 69
- Empty viewport render items: 0
- Timeline result items: 30
- Dense group rows represented by the tested group: 386
- Group pages read: 2
- Exact, geometry, and grouped details: pass
- Canceled import rollback: pass
- Restart creates an empty database: pass
- Exact query: 4 ms
- Dense query: 211 ms
- Timeline query: 78 ms

The dense result stayed below the configured normal render budget of 1,000.
No reliable browser-process memory number was recorded; bounded responses,
worker ownership, heartbeat progress, and the absence of complete datasets in
React are covered structurally and by automated assertions.

## Desktop 30,000-row validation

Command:

```text
npm run validate:desktop-large-file
```

Result: pass

- Import duration: 2,169.71 ms
- SQLite size: 21,213,184 bytes
- Approximate heap delta: 18.11 MiB
- Dense viewport: 24,000 matches represented by 12 render items
- Exact viewport: 400 matches and 400 render items
- Sparse viewport: 272 matches and 272 render items
- Empty viewport: 0 matches
- Timeline viewport: 5,418 matches represented by 12 render items
- Exact details: pass
- Two deterministic 30-row group pages: pass

## Automated regression matrix

All commands passed after the production cutover:

```text
npm run lint
npm run build
npm run build:desktop
npm run smoke:csv-compatibility
npm run smoke:data-source-normalization
npm run smoke:runtime-data-source
npm run smoke:browser-sqlite-database
npm run smoke:browser-sqlite-dataset-mutations
npm run smoke:browser-sqlite-dataset-queries
npm run smoke:browser-sqlite-dataset-removal
npm run smoke:browser-sqlite-import-transaction
npm run smoke:browser-sqlite-importer
npm run smoke:browser-sqlite-import-batch
npm run smoke:browser-sqlite-protocol
npm run smoke:browser-sqlite-worker-runtime
npm run smoke:browser-sqlite-worker-client
npm run smoke:browser-sqlite-data-source
npm run smoke:browser-sqlite-ui
npm run smoke:browser-sqlite-points
npm run smoke:browser-sqlite-geometries
npm run smoke:desktop-data-source
npm run smoke:desktop-workflow
npm run smoke:csv-import-batch
npm run smoke:csv-import-drop
npm run smoke:sqlite-datasets
npm run smoke:sqlite-store
npm run smoke:sqlite-viewport
npm run smoke:sqlite-detail
npm run validate:desktop-large-file
npm run validate:browser-sqlite-worker
```

The browser SQLite smoke commands are also registered under
`npm run smoke:browser-sqlite`, which runs the complete browser SQLite smoke
suite and prevents the lower-level database and dataset checks from being
omitted in future validation.

## Intentional differences from the removed raw path

- Browser datasets are held in temporary SQLite rather than React state.
- Normal map queries are viewport-bounded and use deterministic grouping.
- Leaflet receives compact results capped by a 1,000-item render budget.
- Preview, feature details, and grouped rows are loaded in bounded pages.
- The old 500-row mobile cap is removed.
- The old warning before rendering more than 3,000 raw markers is removed.
- The UI does not derive complete point, line, and region collections from raw
  rows on the main thread.

The day-of-year control behavior remains unchanged as required by issue #103;
fixing that behavior is outside issue #108.
