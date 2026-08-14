# Browser parity baseline


> Historical parity baseline: this document records behavior before the issue
> #108 browser cutover. For the final runtime, see
> [SQLite data-source architecture](./browser-sqlite-ui-integration.md).
This document records the user-visible behavior of the current GitHub Pages
browser implementation before the backend-neutral data contract is completed.
Future browser backends should preserve the required behavior below unless a
separate issue intentionally changes it.

The baseline describes behavior, not the current in-memory architecture. A
future backend may implement it differently.

## Required parity

### Imports

- The **Import...** button opens a browser file picker that accepts CSV files
  and allows multiple selection.
- Dragging files over the application shows a drop target. A drop imports files
  whose name ends in `.csv` or whose MIME type is `text/csv`.
- Multiple files are parsed client-side and added to the dataset list. The most
  recently imported files appear first, and the newest import is selected.
- Up to 100 files may be held in one browser session.
- Parsing is tolerant: missing cells become empty strings, extra cells are
  truncated with a warning, blank lines are skipped, and parser failures are
  shown as warnings instead of crashing the application.
- Imports are temporary. Parsed rows are not persisted to local storage or
  session storage.
- Repeated safe `?example=*.csv` URL parameters load bundled examples in order.
  Explicit subfolder paths are supported. Bare filenames retain the legacy
  lookup and examples-index fallback.

### Dataset list and preview

- Every imported dataset shows its name and loaded row count and can be
  selected, shown or hidden on the map, and unloaded.
- The selected dataset shows its name, file size, total usable row count, and
  column count.
- Latitude and longitude columns are auto-detected where possible and can be
  changed manually per dataset. Missing auto-detection produces a non-fatal
  warning.
- Parser warnings are expandable. The interface displays the first 15 warning
  messages and indicates when more exist.
- Preview rows preserve source-file order. The preview initially shows 30 rows,
  and **Show 30 more** reveals the next page until every loaded row is visible.

### Map features

- Only enabled datasets contribute features to the map.
- Rows with valid mapped coordinates become points unless their declared
  feature type is line or region.
- Point `marker` values select the marker presentation. Point `image` values
  support absolute paths, HTTP(S) URLs, or names resolved below
  `/point-images/`. Image width and height use bounded meter values with current
  defaults.
- Line rows are grouped by `featureId`. Numeric `order` controls vertex order,
  otherwise source order is used. The first usable style and arrow values
  determine line presentation.
- Region rows are grouped by `featureId` and optional `part`. Numeric `order`
  controls vertex order, source order is the fallback, polygon rings are
  closed, and current stroke/fill styles are preserved.
- Exact map features retain a stable dataset/source-row reference for detail
  lookup. Normal map results do not need to carry a complete source row.
- Selecting a point opens the marker-details panel with coordinates and the
  remaining source fields. The panel can be resized, collapsed, reopened, and
  closed.
- Lines and regions show source-row details in map popups.

### Timeline

- The Map tools menu enables or disables the timeline and marker clustering.
- The timeline starts disabled, so dated, undated, and out-of-range features are
  initially visible. Browser and desktop modes share this default.
- A detected `year` field takes precedence over a detected date field. Explicit
  year/date range fields are also supported.
- Enabling the timeline uses the configured `-2100` to `2026` default domain and
  selected range. The visible year range filters points, lines, and regions,
  excludes undated features, and reports the number skipped.
- Importing, selecting, showing, hiding, or removing a dataset does not change
  the configured range. Each dataset can provide a recommended range, which is
  applied only through its explicit context-menu action.
- The year domain can be entered manually. Timeline playback advances the
  selected range using the configured year step and interval.
- Timeline state is kept in session storage.

#### Current day-of-year behavior

This behavior is intentionally precise because the current controls are ahead
of the current map-filtering implementation:

- The **More filters** expander exists in the timeline panel.
- Opening it enables the day filter and initializes an unset range to 1–365.
- The panel displays the detected day-of-year field.
- The range has a 1–365 slider and read-only **Start** and **End** values.
- Closing the expander disables the day filter but retains its range.
- Wrap-around is explained as `Start > End`, meaning
  `day >= Start OR day <= End`.
- Explicit day-of-year values and date-derived day numbers can be parsed.
- **The browser map query does not currently apply `dayFilterEnabled`,
  `startDay`, or `endDay`.** Changing those values does not change map results.
  Year filtering continues to apply.

The last item is required migration parity for issue #103. Making day-of-year
state filter the map is a separate bug fix and must not be folded into the data
contract migration.

### Map and panel tools

- Marker clustering is optional and uses the configured 0–300 pixel radius. At radius 0, only exact coordinate matches cluster; nearby markers with different coordinates remain separate.
- The map tools menu closes on an outside click or Escape.
- The map supports the current blank, OpenStreetMap, imagery, and reference
  layer choices and the existing zoom/pan behavior.
- The CSV panel and marker-details panel retain their current open, close,
  collapse, and resize behavior.

## Characterization coverage

Run `npm run smoke:browser-parity` to check representative browser data
behavior:

- disabled datasets do not render;
- points, ordered/styled lines, and multipart-capable regions retain their
  current derivation behavior;
- exact features have stable source references without embedded source rows;
- exact details and deterministic row paging return original rows;
- year ranges filter map results; and
- day-of-year state does not currently filter map results.

UI-only behavior and native browser interactions remain documented manual
checks until the repository has a browser component/end-to-end test harness.

## Intentional legacy limitations

These are current implementation constraints, not parity requirements for a
future backend:

- A likely mobile or small-device import larger than 1 MB stores at most 500
  usable rows and reports the cap as a warning.
- Disabling clustering with more than 3,000 visible raw markers asks for
  confirmation.
- The browser derives and renders all raw markers before Leaflet clustering.
- Complete datasets are retained in React memory for the session.
- The current browser backend does not provide large-result server/database
  grouping or a render-budget limit.

Removing these limitations later is allowed as long as the required functional
behavior above remains available.

## Scope guardrails

This baseline does not activate SQLite WASM, change browser persistence, replace
the browser import path, remove raw browser state, redesign the interface, or
make day-of-year filtering functional.
