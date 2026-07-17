# SQLite Import Prototype

Issue #81 adds the desktop SQLite import path, issue #82 adds viewport querying, issue #83 adds grouped render results, and issue #84 adds on-demand marker details and paged group rows. Issue #90 provides repeatable viewport smoke coverage.

## Runtime Boundary

SQLite access belongs to the Electron desktop runtime only. The browser and GitHub Pages path should continue to use the existing in-memory CSV flow.

The renderer talks to the desktop runtime through the narrow preload bridge:

- `window.csvMapDesktop.isDesktop`
- `window.csvMapDesktop.getStatus()`
- `window.csvMapDesktop.importCsvToSqlite()`
- `window.csvMapDesktop.queryMapView(query)`
- `window.csvMapDesktop.getFeatureDetails(query)`
- `window.csvMapDesktop.getGroupRows(query)`

The renderer does not pass arbitrary IPC channel names, local file paths, SQL, or database paths. The Electron main process owns the file picker, database path, SQLite import work, and viewport query execution.

## Database Location

The prototype database is stored under Electron's app data directory:

```text
app.getPath("userData") / csv-map-layer-visualizer.sqlite
```

This keeps imported local data outside the repository and outside the browser build output.

## Native Module Rebuild

`better-sqlite3` is a native Node module. If Electron shows a `NODE_MODULE_VERSION` mismatch when importing, rebuild the module for the Electron runtime and restart the desktop app:

```bash
npm rebuild better-sqlite3 --runtime=electron --target=43.1.0 --dist-url=https://electronjs.org/headers
```

This rebuild is for local development only. It does not change the browser/GitHub Pages path.

## Prototype Schema

The schema is intentionally small and import-focused.

### `datasets`

One row per imported CSV file:

- `id`
- `file_name`
- `source_path`
- `row_count`
- `imported_feature_count`
- `skipped_row_count`
- `columns_json`
- `imported_at`

### `features`

One row per imported CSV row with valid point coordinates:

- `id`
- `dataset_id`
- `source_row_index`
- `lat`
- `lon`
- `timeline_start_year`
- `timeline_end_year`
- `compact_json`
- `row_json`

`row_json` preserves the original row for later detail lookup. `compact_json` stores lightweight fields that later map queries may need without reading the full row.

## Index Direction

The prototype creates indexes for later issues:

- `features(dataset_id)` for dataset-scoped reads
- `features(dataset_id, lat, lon)` for future viewport queries
- `features(dataset_id, timeline_start_year, timeline_end_year)` for future timeline filtering
- unique `features(dataset_id, source_row_index)` for stable row/detail lookup

These indexes support the desktop viewport query path.

## Viewport Query

Issue #82 adds a desktop-only SQLite viewport query that runs through the fixed Electron preload bridge. The browser and GitHub Pages path still use the in-memory CSV flow.

The query uses the current map bounds, zoom, timeline state, and a render budget. It queries all imported SQLite datasets for now. Dataset selection, enable/disable controls, and delete/manage UI are future work.

The render budget is `1000`. Under-budget results return exact compact points. Over-budget results return deterministic grouped or representative points produced after the bounds and timeline filters are applied.

Viewport query results include compact marker/render data only:

- stable id
- latitude
- longitude
- source reference for exact points
- group id, count, and compact lookup context for grouped results
- marker/image fields when present in `compact_json`
- coordinate field names when present in `compact_json`

The viewport query does not read or return `row_json`. Exact details and group rows are fetched separately only after the user opens a marker popup.

## On-Demand Marker Details and Group Rows

Issue #84 adds two desktop-only lookup paths:

- `getFeatureDetails(query)` reads one full row by stable dataset id and source row index.
- `getGroupRows(query)` reads one deterministic page of rows represented by a grouped marker.

Grouped viewport results carry a compact `groupRef` with the originating bounds, normalized timeline filter, grid cell identity and dimensions, and fixed dataset/source-row ordering. Paging reuses this captured context instead of the current map state.

The first group page contains 30 rows. The grouped popup can request another 30 rows with `Show 30 more` until all matching rows are loaded. Full rows remain separate from the marker render result and React only stores details for the popup the user opened.

## SQLite Query Smoke Checks

Issue #90 adds a repeatable check for the SQLite viewport query path:

```bash
npm run smoke:sqlite-viewport
npm run smoke:sqlite-detail
```

The smoke scripts create isolated in-memory SQLite databases. The viewport suite calls `querySqliteMapView(...)`, while the detail suite calls the exact and grouped lookup functions directly. Neither suite opens the Electron UI or reads from or modifies the app database under `userData`.

The current scenarios cover:

- exact viewport results when the matching rows stay under the render budget
- grouped and representative results when matching rows exceed the render budget
- grouped counts and deterministic representative marker selection
- timeline filtering before grouped result generation
- compact render results that do not expose `row_json` or full row/detail fields
- exact detail lookup by stable source reference
- missing detail rows
- deterministic group paging across datasets
- group paging with the originating timeline filter
- invalid lookup context and paging input

Each npm command starts with the local Node runtime, then its script relaunches itself in Electron's Node mode before loading `better-sqlite3`. This keeps the native module on the same ABI as the desktop app. If the native module has an ABI mismatch, use the Electron rebuild command in [Native Module Rebuild](#native-module-rebuild).

To extend the smoke coverage, add an isolated fixture and assertion to the relevant viewport or detail smoke file. Keep the full-row sentinel assertion for new viewport result shapes so detail data does not enter the render query by accident.

## Manual Acceptance Check

Use `npm run desktop:start` with one small CSV and one dense CSV containing more than 30 points in a group:

1. Open an exact marker and confirm its original row fields load.
2. Open a grouped marker and confirm the first page reports up to 30 represented rows.
3. Expand several rows, select `Show 30 more`, and confirm the next page appends without duplicates.
4. Enable a timeline range and confirm grouped detail counts and rows use that same range.
5. Load a CSV through the normal browser flow and confirm its existing marker popup still works.

## Non-Goals

This prototype does not:

- replace the browser/GitHub Pages CSV flow
- support DuckDB, remote data sources, or unlimited CSV sizes
