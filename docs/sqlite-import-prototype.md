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

## Large-File Desktop Validation

Issue #85 adds a repeatable 30k-row validation command for the full desktop SQLite path:

```bash
npm run validate:desktop-large-file
```

The runner generates a temporary CSV, imports it through the production SQLite importer, runs viewport/detail/paging queries, reports measurements, and removes its temporary CSV and database. For a manual Electron check, preserve the generated files explicitly:

```bash
npm run validate:desktop-large-file -- --keep-files
```

The opt-in command prints the temporary directory and CSV path. Remove those files after the manual check; normal validation runs continue to clean up automatically.

### Validation Fixture

The deterministic fixture contains 30,000 valid point rows:

- 24,000 points in one dense Stockholm area
- 5,600 points spread through a sparse European area
- 400 points in a separate exact-marker area
- timeline ranges, marker values, names, and detail comments on every row

This fixture exercises grouped, exact, sparse, empty, timeline-filtered, detail, and paged-row paths without committing a large CSV to the repository.

### Automated Results

Measurements were recorded on the local Windows development machine on 2026-07-18. Two consecutive final runs produced stable counts and similar timings:

| Scenario | Observed result |
| --- | --- |
| CSV import | 30,000 of 30,000 rows, zero skipped, 2.02-2.25 seconds |
| File sizes | 2,029,375-byte CSV; 21,213,184-byte SQLite database |
| Approximate import heap change | 18.03-18.25 MiB in the Electron main-process validation runner |
| Dense viewport | 24,000 matches represented by 12 groups; 77.78-79.60 ms warm median |
| Exact viewport | 400 exact markers; 16.29-16.58 ms warm median |
| Sparse viewport | 272 exact markers; 16.01-16.04 ms warm median |
| Empty viewport | zero results; 15.60-15.62 ms warm median |
| Timeline viewport | 5,418 matches and 18,582 skipped for 2000-2005; 30.65-30.74 ms warm median |
| Exact detail | original row fetched on demand; 0.03 ms warm median |
| Group paging | two stable 30-row pages without duplicates; approximately 5 ms warm median |

The dense, exact, and timeline results were stable across repeated queries. Group IDs, counts, representative markers, source references, detail rows, and page ordering remained deterministic.

### Manual Electron Results

The generated fixture was imported through the visible Electron UI using an isolated temporary `userData` directory:

- the UI reported `Stored 30000 of 30000 rows`
- pan and zoom remained responsive
- the dense area rendered as a grouped marker representing 24,000 rows
- exact sparse markers loaded their original row details on demand
- `Show 30 more` advanced grouped rows from 30 to 60 and then 90 without observed duplicates
- the 2000-2005 timeline range produced the expected 5,418 grouped rows
- timeline-filtered group paging continued to return matching rows
- three idle renderer readings were stable at 13.64 MiB used JavaScript heap and 18.41 MiB allocated JavaScript heap

The existing render budget of 1,000 and group page size of 30 were sufficient for this first-pass target, so neither limit was changed.

### Browser Comparison

The same generated CSV was loaded through the normal browser/in-memory flow. Firefox Developer Edition parsed and listed all 30,000 rows, and clustered markers eventually appeared after roughly 40 seconds. The page remained effectively unusable, with roughly 40-second interaction updates and Firefox's slow-page warning. Pan/zoom and DevTools memory inspection could not be completed reliably.

This comparison does not change the browser path or claim large-file GitHub Pages support. Browser large-file performance remains a non-goal for the desktop validation work.

### Conclusion and Follow-Up

SQLite live queries are sufficient for the first desktop version at the 30k-row target. The measured viewport, timeline, detail, and paging queries do not justify DuckDB, precomputed map tiles, or a different render budget.

No desktop query bottleneck was found at 30,000 rows. Import remains the longest measured desktop operation at about two seconds and currently parses the complete file before insertion; profile that path again before raising the supported target substantially.

One unrelated visual issue was observed in the `Visible year range` slider during manual testing. Its displayed slider state did not match the applied range consistently. The timeline query and grouped result counts were correct, so that visual issue remains separate follow-up work outside issue #85.

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
