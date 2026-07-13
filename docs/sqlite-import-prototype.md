# SQLite Import Prototype

Issue #81 adds the first desktop-only path for importing local CSV files into a SQLite-backed prototype store. Issue #82 adds the first SQLite-backed viewport query for rendering compact desktop map results.

## Runtime Boundary

SQLite access belongs to the Electron desktop runtime only. The browser and GitHub Pages path should continue to use the existing in-memory CSV flow.

The renderer talks to the desktop runtime through the narrow preload bridge:

- `window.csvMapDesktop.isDesktop`
- `window.csvMapDesktop.getStatus()`
- `window.csvMapDesktop.importCsvToSqlite()`
- `window.csvMapDesktop.queryMapView(query)`

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

The first render budget is `1000`. If more datapoints match the current viewport/filter, the query returns the first `1000` compact point records and reports how many matching datapoints are hidden. The panel displays that as a status message, for example:

```text
9,500 datapoints are not being displayed
```

Viewport query results include compact marker/render data only:

- stable id
- latitude
- longitude
- source reference
- marker/image fields when present in `compact_json`
- coordinate field names when present in `compact_json`

The viewport query does not read or return `row_json`. Full row details remain a separate lookup concern for later work.

## SQLite Viewport Smoke Check

Issue #90 adds a repeatable check for the SQLite viewport query path:

```bash
npm run smoke:sqlite-viewport
```

The smoke script creates isolated in-memory SQLite databases and calls `querySqliteMapView(...)` directly. It does not open the Electron UI or read from or modify the app database under `userData`.

The current scenarios cover:

- exact viewport results when the matching rows stay under the render budget
- grouped and representative results when matching rows exceed the render budget
- grouped counts and deterministic representative marker selection
- timeline filtering before grouped result generation
- compact render results that do not expose `row_json` or full row/detail fields

The npm command starts with the local Node runtime, then the script relaunches itself in Electron's Node mode before loading `better-sqlite3`. This keeps the native module on the same ABI as the desktop app. If the native module has an ABI mismatch, use the Electron rebuild command in [Native Module Rebuild](#native-module-rebuild).

To extend the smoke coverage, add another isolated fixture and assertion function in `desktop/sqliteViewportQuery.smoke.cjs`. Keep the full-row sentinel assertion for new viewport result shapes so detail data does not enter the render query by accident.

## Non-Goals

This prototype does not:

- add grouped or representative markers
- add full marker detail lookup UI
- add paged group rows
- replace the browser/GitHub Pages CSV flow
- support DuckDB, remote data sources, or unlimited CSV sizes
