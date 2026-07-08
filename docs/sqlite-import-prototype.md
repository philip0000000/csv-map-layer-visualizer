# SQLite Import Prototype

Issue #81 adds the first desktop-only path for importing local CSV files into a SQLite-backed prototype store.

## Runtime Boundary

SQLite access belongs to the Electron desktop runtime only. The browser and GitHub Pages path should continue to use the existing in-memory CSV flow.

The renderer talks to the desktop runtime through the narrow preload bridge:

- `window.csvMapDesktop.isDesktop`
- `window.csvMapDesktop.getStatus()`
- `window.csvMapDesktop.importCsvToSqlite()`

The renderer does not pass arbitrary IPC channel names, local file paths, or database paths. The Electron main process owns the file picker, database path, and SQLite import work.

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

These indexes are not yet used for Leaflet rendering. They document and prove the storage direction needed by follow-up query work.

## Non-Goals

This prototype does not:

- render SQLite-backed markers in Leaflet
- implement viewport queries
- add grouped or representative markers
- add marker detail UI
- add paged group rows
- replace the browser/GitHub Pages CSV flow
- support DuckDB, remote data sources, or unlimited CSV sizes