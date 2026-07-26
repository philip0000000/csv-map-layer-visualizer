# Data contract inventory and gap analysis

This document inventories the data operations currently used by the React and
Leaflet interface. It compares the browser/in-memory and Electron/SQLite paths
with the partial contract in `src/data/dataSource.js` and records the contract
work still required by issue #103.

This is an implementation inventory, not a proposal to change behavior. The
browser parity requirements are recorded separately in
`docs/browser-parity-baseline.md`.

## Current runtime ownership

| Layer | Browser/in-memory | Desktop/Electron |
| --- | --- | --- |
| Runtime selection | `useRuntimeDataSource` selects `inMemoryDataSource` | `useRuntimeDataSource` selects `desktopSqliteDataSource` from the fixed preload marker |
| Backend state | The adapter owns parsed files and selection; `useCsvFiles` projects normalized panel state | SQLite persists data; `App.jsx` retains only renderer view state |
| Import | Selected adapter parses browser `File` or example inputs | Selected adapter invokes safe picker/drop preload methods; Electron main owns paths |
| Map query | `useDerivedMapFeatures` queries the selected in-memory adapter | `App.jsx` queries the selected adapter on viewport changes |
| Dataset metadata | Adapter summaries plus a selected preview page feed the panel | Adapter summaries cross the preload/IPC boundary |
| Details | Adapter details are bridged to the current synchronous popup shape | Adapter performs asynchronous exact/group lookups through preload/IPC |
| Preview and mapping | Adapter operations support both | Adapter capabilities report both unavailable |
| Resource lifetime | `useRuntimeDataSource` initializes and disposes the selected adapter | The hook disposes renderer listeners; main-process operations close SQLite resources |

Exactly one adapter is selected and initialized for a page session. The inactive
runtime adapter is not used, and `App.jsx` receives only the selected contract,
capabilities, initialization state, and a controller revision.

## Operation inventory

The table below records the implementation state when the inventory was taken,
before the contract and in-memory adapter work began. It remains the migration
baseline; current progress is summarized immediately after the table.

Status meanings:

- **Declared**: present in `DATA_SOURCE_METHODS` and the `DataSource` JSDoc.
- **Adapter only**: implemented by at least one adapter but absent from the
  formal contract.
- **Outside contract**: performed directly by hooks, `App.jsx`, preload, or
  presentation components.
- **Missing**: required by issue #103 but not currently implemented for that
  runtime.

| Responsibility | Browser/in-memory path | Desktop/SQLite path | Contract status and gap |
| --- | --- | --- | --- |
| Initialize backend | No explicit initialization; browser state starts empty | `getStatus` exists in preload, while database/schema initialization happens implicitly when an operation opens the store | Outside contract. Add explicit initialization result and failure semantics |
| Report capabilities and persistence | Behavior is inferred from `isDesktop` and callback availability | Behavior is inferred from preload method availability | Missing. Add stable capabilities including temporary versus persistent data and supported import/query/mutation features |
| Dispose resources | React unmount discards memory; no backend method | Every main-process handler closes its database; no renderer-facing disposal | Missing. Add idempotent disposal even when an implementation has nothing to release |
| Browser picker import | Hidden multiple-file input passes `File[]` to `useCsvFiles.importFiles` | Not used | Outside contract. Add a browser-safe import entry point |
| Desktop picker import | Not used | `App.jsx` calls `desktopApi.importCsvToSqlite`; Electron main opens the native picker | Outside contract. Add a desktop picker operation that never exposes paths to shared UI |
| Drag-and-drop import | `useCsvFileDrop` filters `File[]`, then calls `importFiles` | The same hook passes dropped `File[]` to preload, which safely converts them to paths before IPC | Outside contract. Preserve runtime-safe entry points rather than inventing a shared path type |
| Example URL import | URL hook calls `useCsvFiles.importExampleFile`; the hook fetches and parses the example | Disabled by an `isDesktop` branch | Outside contract. Treat as a browser import source or controller operation |
| Multiple-file results | Files are parsed sequentially; results become file objects and warnings in React | Main process returns independent per-file success/failure results | Outside contract. Add normalized batch and per-file results |
| Import progress | No progress stream beyond completion | Preload subscribes to an IPC event; `App.jsx` normalizes and stores progress | Outside contract. Add a subscription or callback contract with cleanup |
| Import cancellation | No active cancellation | Native picker cancellation is reported; an import already in progress cannot be canceled | Missing. Capability must report unavailable cancellation or expose a cancellation operation when supported |
| Dataset summaries | `inMemoryDataSource.getDatasetSummary` maps raw file state | Adapter normalizes `getDatasetSummary` IPC output | Declared, but result fields differ and desktop selection is not represented |
| Dataset selection | `useCsvFiles` owns selected ID and falls back to the first file | No desktop dataset can be selected; the panel receives `selectedId=null` | Outside contract/controller. Add backend-neutral selection state without treating it as persistence unless required |
| Dataset visibility | `useCsvFiles.updateFileEnabled` mutates React state | Adapter calls `setDatasetEnabled`; `App.jsx` manages pending and error state | Adapter only. Declare the mutation and normalize its result/error |
| Dataset removal | `useCsvFiles.unloadFile` removes temporary React state | Adapter calls `removeDataset` after a confirmation in `App.jsx` | Adapter only. Declare removal; keep confirmation in UI/controller |
| Coordinate mapping | `useCsvFiles.updateFileMapping` patches `latField` and `lonField` | Not exposed through SQLite service, preload, or adapter | Outside contract in browser and missing on desktop. Add a mapping mutation and detected timeline-field metadata |
| Preview page | `CsvPreviewTable` slices the complete selected `rows` array in increments of 30 | Not available | Missing. Add dataset preview paging that preserves source order and returns count/page metadata |
| Viewport map query | Browser adapter derives all enabled data and ignores bounds, zoom, and render budget | Desktop adapter sends bounds, zoom, timeline, and budget; SQLite currently uses bounds, timeline, and budget | Declared. Clarify supported query inputs, enabled-dataset semantics, compact results, and normalized stats |
| Exact feature details | Browser adapter synchronously returns a raw source row | Desktop adapter asynchronously normalizes an IPC lookup | Declared. Keep the async-or-sync contract and normalize failures consistently |
| Grouped row page | Browser implementation pages a whole dataset using `datasetId` | Desktop implementation requires an immutable `groupRef` and deterministic ordering | Declared, but browser behavior is dataset paging rather than grouped-marker paging. Keep grouped paging distinct from preview paging |
| Timeline metadata | `App.jsx` scans raw selected headers and rows to detect fields and calculate the domain | Dataset summary currently returns `timeline: null`, and selected-dataset fields are unavailable | Outside contract. Dataset summaries/mapping results must expose the metadata needed by the timeline UI |
| Backend failures | Hooks and `App.jsx` create operation-specific strings; unavailable adapter methods often return empty results | IPC errors are caught in `App.jsx`; adapter normalizes some malformed successful responses | Missing stable failure model and categories |

## Current contract implementation status

At inventory time, `src/data/dataSource.js` declared only `queryMapView`,
`getFeatureDetails`, `getGroupRows`, and `getDatasetSummary`.

The formal contract now covers lifecycle, capabilities, runtime-safe imports,
progress, cancellation, datasets, selection, visibility, removal, mappings,
preview paging, map queries, exact details, grouped paging, normalized failures,
and disposal. Shared normalization is implemented in
`src/data/dataSourceNormalization.js`.

The in-memory adapter now implements every declared method and reconstructs
normalized compact results while retaining temporary legacy source fields for
the active UI. The React browser controller now delegates picker, drop, and
example imports, dataset mutations, selection, preview reads, map queries, and
detail reads to that adapter. The desktop adapter also implements every declared
method, normalizes all supported bridge results, and reports unsupported
selection, mapping, preview, example-import, and cancellation operations through
capabilities and safe failures. `useRuntimeDataSource` now selects, initializes,
and disposes exactly one of those adapters for the page session; the inactive
runtime adapter is not constructed.

## Remaining adapter migration notes

The contract now includes the desktop dataset counters, extended map statistics,
and day-of-year state identified during the original comparison. These runtime
differences still need adapter or controller work:

- Browser summaries report loaded `rowCount`, `totalRows`, mappings, and parser
  warnings from React file objects. Desktop summaries do not currently expose
  mapping fields or retained parser warnings from persisted imports.
- Desktop mapping and preview remain intentionally unavailable until SQLite
  services support them; the adapter advertises those capability limits.
- `App.jsx` retains separate compatibility view state where current capabilities
  differ, but all backend operations use the one selected adapter.
- Electron services retain runtime-specific result shapes internally, while the
  renderer adapter now converts imports, progress, mutations, queries, and
  failures to the shared contract.

## Runtime-specific dependencies reaching shared UI

The remaining presentation migration is intentionally narrower now that one
backend is selected:

- `useRuntimeDataSource` is the only shared React code that reads
  `globalThis.csvMapDesktop`; `App.jsx` receives the selected adapter and its
  capabilities and no longer calls Electron preload methods directly.
- `App.jsx` still contains separate browser and desktop view-state handling for
  datasets, queries, and detail loaders where current capabilities differ.
- `App.jsx` selects compatibility props using controller workflow decisions and
  capabilities rather than reading a backend identity.
- `CsvPanel` and `CsvFileControls` receive desktop-only import and dataset-state
  objects alongside browser callbacks.
- `CsvPanel` reads the selected browser dataset object, including complete rows,
  for metadata, mapping, warnings, and preview.
- `App.jsx` scans complete selected browser rows to derive the timeline domain.
- `useDerivedMapFeatures` translates the contract result back into a legacy
  shape and recreates a synchronous raw-row lookup.
- `GeoMap` and line/region popup helpers can still obtain complete browser rows
  through `getSourceRow`.
- Marker details choose between the synchronous browser row path and the
  asynchronous desktop contract path.

The existing security boundary is sound in one important respect: shared React
code does not choose IPC channel names, send SQL, receive database handles, or
directly receive desktop filesystem paths. The completed contract must preserve
that boundary.

## Implemented contract additions

The completed method and result signatures are defined in
`src/data/dataSource.js`. The list below retains the rationale for the original
gaps that are now implemented.

### Lifecycle and capabilities

- `initialize()` returning a normalized `InitializationResult`.
- `getCapabilities()` or an immutable `capabilities` value returning
  `BackendCapabilities`.
- `dispose()` with idempotent cleanup semantics.
- Capabilities for persistence, browser picker import, drag-and-drop import,
  mapping changes, preview, points, lines, regions, grouped viewport results,
  and import cancellation.

### Imports

- Separate runtime-safe operations for browser `File` inputs, desktop native
  picker requests, and desktop dropped-file inputs where needed.
- `ImportProgress`, `ImportFileResult`, and `ImportBatchResult` shapes.
- Progress subscription cleanup and a clear cancellation result/capability.
- Independent file failures and normalized warnings, skipped rows, and errors.

### Dataset operations

- Declare `setDatasetEnabled(datasetId, enabled)`.
- Declare `removeDataset(datasetId)`.
- Add `updateDatasetMapping(datasetId, mapping)` returning detected coordinate
  and timeline-field metadata.
- Keep selected dataset ID in the shared controller unless a backend genuinely
  needs to persist selection.
- Align `DatasetSummaryItem` with the metadata actually required by the panel,
  without adding complete rows.

### Preview, map, and details

- Add `getPreviewPage({ datasetId, offset, limit })` with a dedicated
  `PreviewPageResult` that preserves source order.
- Retain `queryMapView`, `getFeatureDetails`, and `getGroupRows` with normalized
  inputs, results, and failures.
- Keep `PreviewPageResult` and `GroupRowsResult` as distinct types even if both
  contain rows, offsets, limits, and totals.
- Extend map statistics and normalize points, lines, regions, source refs,
  group refs, and timeline indexes at every adapter boundary.
- Keep complete source rows out of `MapViewResult`.

### Failures

- Add a normalized `BackendFailure` shape with a stable category, safe message,
  operation, and optional recoverability/context fields.
- Required categories include backend unavailable, initialization failed,
  import failed, import canceled, invalid mapping, dataset not found, and query
  failed.
- Convert runtime exceptions, malformed responses, IPC failures, and future
  worker errors at the adapter boundary. Do not expose SQL, paths, IPC names,
  worker internals, or database objects.

## Recommended migration order

1. Expand and document types and method signatures in `dataSource.js`.
2. Add shared normalization and failure helpers with contract tests.
3. Complete the in-memory adapter by moving browser mutations, preview, and
   import-facing operations behind the boundary.
4. Complete the desktop adapter and bridge only where the desktop runtime
   supports the operation.
5. Introduce one runtime backend selector and shared controller/hook.
6. Move presentation components from raw rows and desktop-specific props to the
   controller operations and normalized state.

This order keeps the current browser/raw and desktop SQLite paths active while
ensuring SQLite WASM remains a non-production prototype.
