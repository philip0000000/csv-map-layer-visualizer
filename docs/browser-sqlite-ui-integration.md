# Browser SQLite UI integration

Issue #107 connects the temporary browser SQLite worker to the existing React
and Leaflet interface without changing the production browser default.

## Starting the test mode

Use `npm run dev:browser-sqlite` for development and
`npm run build:browser-sqlite` for a validation build.

The `browser-sqlite` Vite mode sets `VITE_BROWSER_DATA_BACKEND=sqlite` at build
time. Normal `npm run dev` and `npm run build` continue to select the raw
in-memory browser backend. This flag is not exposed as a user-facing setting.

## Selection and lifecycle

`useRuntimeDataSource` reads the build-time setting once and
`selectRuntimeDataSource` creates exactly one session data source. Electron
continues to select persistent desktop SQLite. A browser session selects either
raw data or temporary SQLite, never both.

SQLite initialization must finish before imports are enabled. Worker creation
or initialization failure is shown in the panel and does not fall back to raw
data. Disposing the source terminates the worker. No persistence path is
activated, so reloads and separate tabs receive separate empty databases.

## Import and dataset coordination

The existing picker and drop target pass browser `File` objects through the
selected data-source boundary. Example URLs use the shared safe resolver and
feed their fetched CSV into the same SQLite import method. Progress and mixed
per-file results are normalized before reaching the panel.

The loaded-files panel reads compact summaries. Selection, visibility, removal,
and mapping changes call the active adapter and invalidate summary and map
reads. Preview rows are requested in pages of 30. A request token prevents an
old or removed dataset response from replacing the current preview.

## Map, details, and paging

Leaflet reports the initial viewport and completed movement. Database-backed
queries are debounced and contain bounds, zoom, timeline state, enabled dataset
IDs, and a render budget. Only the latest generation may update the map. The
last valid result remains visible during refreshes and query errors.

Mapping changes rebuild derived records transactionally. Exact point details
load after point selection. Line and region rows load only when their popup
opens. Closing or changing a selection invalidates its detail request.

Grouped points retain the immutable `groupRef` from their originating viewport
query. Pages use a fixed size of 30 and deterministic source offsets,
independent of later map or timeline changes.
