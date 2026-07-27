# Browser SQLite import architecture


> Historical design note: this document records the issue #104 implementation
> stage. Issue #108 later made this backend the exclusive browser path; see
> [SQLite data-source architecture](./browser-sqlite-ui-integration.md).
Issue #104 turns the successful SQLite WASM compatibility prototype into a
reusable, temporary browser storage and import backend. This document fixes the
architecture and scope before implementation begins.

The backend described here is not selected by the normal runtime yet. The
existing in-memory GitHub Pages workflow and the desktop `better-sqlite3`
workflow remain active and unchanged.

## Scope

This issue provides:

- a fresh in-memory `sql.js` database owned by one dedicated module worker;
- incremental import of one or more browser `File` objects;
- dataset metadata and all usable original CSV rows in SQLite;
- normalized progress, cancellation, per-file success, and per-file failure;
- dataset summaries, source-row preview paging, visibility changes, coordinate
  mapping metadata changes, and dataset removal; and
- a backend-neutral adapter that follows `src/data/dataSource.js` without being
  added to `runtimeDataSource.js`.

This issue does not provide map viewport queries, derived point/line/region
records, grouped results, React or Leaflet integration, browser persistence, or
changes to the desktop database.

## Proposed production modules

Production code will live under `src/data/browserSqlite/`.

| Module | Responsibility |
| --- | --- |
| `browserSqliteDataSource.js` | Implements the backend-neutral data-source contract, normalizes results and failures, and owns session-only dataset selection. |
| `browserSqliteWorkerClient.js` | Creates the worker, correlates request IDs, forwards progress, detects worker loss, rejects pending requests, and disposes the session. |
| `browserSqliteProtocol.js` | Defines the fixed operation names, validates request and response envelopes, and contains no database handles or SQL input. |
| `browserSqliteWorker.js` | Owns the database, dispatches validated operations, serializes database work, and routes cancellation without terminating the worker. |
| `browserSqliteDatabase.js` | Initializes the schema and implements prepared, named dataset and preview operations. |
| `browserSqliteImporter.js` | Runs PapaParse incrementally, inserts bounded row batches, reports progress, and owns per-file transaction and rollback behavior. |

Parser compatibility helpers that are currently private to
`src/components/csvParse.js` may be moved into a shared, runtime-neutral helper
module. The existing parser and the SQLite importer must use the same helpers so
header, row, and warning behavior does not drift.

The standalone compatibility prototype was removed after the production worker
and real-browser validation covered the same compatibility evidence. It is not
retained as a parallel implementation.

## Data-source contract mapping

The adapter will implement every method in `DATA_SOURCE_METHODS`, even when a
method is intentionally unsupported in this issue.

| Contract method | Issue #104 behavior |
| --- | --- |
| `initialize` | Start the worker and create a fresh schema. Repeated calls are safe. |
| `getCapabilities` | Return the immutable capability set below. |
| `importBrowserFiles` | Import browser `File` objects through the worker. |
| `importFromPicker` | Return normalized `backend-unavailable`; the shared UI owns the browser picker. |
| `importDroppedFiles` | Import renderer-safe dropped `File` objects through the same worker operation. |
| `importExample` | Return normalized `backend-unavailable` in this backend until a later integration issue defines example loading. |
| `subscribeImportProgress` | Subscribe to normalized worker progress with idempotent cleanup. |
| `cancelImport` | Set the cooperative cancellation flag for the matching active import. |
| `getDatasetSummary` | Return metadata only, never complete row collections. |
| `selectDataset` | Maintain selection in the adapter for the current session; it is not stored in SQLite. |
| `setDatasetEnabled` | Update one dataset without changing any other dataset. |
| `removeDataset` | Transactionally remove one dataset and its source rows. |
| `updateDatasetMapping` | Validate headers and store current latitude/longitude mapping metadata. It does not build derived features. |
| `getPreviewPage` | Return a bounded page ordered by stable source-row index. |
| `queryMapView` | Return normalized `backend-unavailable`; viewport work belongs to a later issue. |
| `getFeatureDetails` | Return normalized `backend-unavailable`; feature derivation and detail lookup belong to later issues. |
| `getGroupRows` | Return normalized `backend-unavailable`; grouped results belong to later issues. |
| `dispose` | Close and terminate the worker once, rejecting outstanding requests and losing the temporary database as documented. |

The planned capabilities are:

| Capability | Value |
| --- | --- |
| `persistence` | `temporary` |
| `browserFileImport` | `true` |
| `nativeFilePickerImport` | `false` |
| `droppedFileImport` | `true` |
| `exampleImport` | `false` |
| `multipleFileImport` | `true` |
| `importProgress` | `true` |
| `importCancellation` | `true` |
| `datasetSelection` | `true` |
| `datasetVisibility` | `true` |
| `datasetRemoval` | `true` |
| `datasetMapping` | `true` |
| `previewPaging` | `true` |
| `points` | `false` |
| `lines` | `false` |
| `regions` | `false` |
| `groupedViewportResults` | `false` |

## Temporary database schema

No database bytes are supplied to `new SQL.Database()`. The worker does not
open or call OPFS, IndexedDB, `localStorage`, `sessionStorage`, or another
persistence API. A worker restart therefore always creates an empty database.

Schema initialization is explicit. SQLite `user_version` records the in-session
schema version, starting at version 1. It is not a persistence or cross-session
migration mechanism.

### `datasets`

One row represents one imported browser file.

| Column | Purpose |
| --- | --- |
| `id` | Stable generated dataset ID and primary key. |
| `file_name` | Sanitized display/file name without a filesystem path. |
| `size_bytes` | Browser-provided file size when available. |
| `mime_type` | Browser-provided MIME type when available. |
| `last_modified_ms` | Browser-provided last-modified value when available. |
| `columns_json` | Ordered normalized column names. |
| `total_parsed_row_count` | Data rows observed after the header, including rows later skipped as malformed. |
| `stored_row_count` | Usable original rows stored in `source_rows`. |
| `skipped_row_count` | Rows not stored because they were unusable or malformed. |
| `enabled` | Integer boolean constrained to zero or one. |
| `detected_fields_json` | Coordinate and timeline fields detected from the normalized headers. |
| `coordinate_mapping_json` | Current latitude and longitude field selection. |
| `warnings_json` | Capped import and parser warnings. |
| `import_state` | Constrained `importing` or `complete` transaction state. |
| `imported_at` | Completion timestamp for the current temporary session. |

The provisional `importing` row and its source rows are created inside the
file's transaction. They cannot survive a rollback. A committed dataset must
have `import_state = 'complete'`.

### `source_rows`

One row represents one usable original CSV data row.

| Column | Purpose |
| --- | --- |
| `dataset_id` | Foreign key to `datasets(id)` with `ON DELETE CASCADE`. |
| `source_row_index` | Stable zero-based index in original usable-row order. |
| `row_json` | Complete normalized original row values. |

The composite primary key is `(dataset_id, source_row_index)`. Preview queries
always order by these columns and apply a validated offset and bounded limit.
Rows are retained even when their current coordinate mapping is missing or
their coordinate values cannot produce valid map geometry.

No derived feature table is required in this issue. Future derived tables can
reference the stable dataset ID and source-row index without changing the
original-row schema.

## Incremental import lifecycle

Files in one batch are processed sequentially. Each file has its own
transaction:

1. Validate safe browser file metadata and generate a dataset ID.
2. Begin the transaction and insert provisional dataset metadata.
3. Start PapaParse on the `File` with automatic delimiter detection, explicit
   bounded chunks, and no nested parser worker.
4. Treat the first non-empty row as the header and normalize it using the
   existing browser rules.
5. Convert later rows to normalized objects in bounded batches.
6. Insert each batch with one reusable prepared statement.
7. Clear references to the processed JavaScript row objects.
8. Yield at safe chunk or batch boundaries so cancellation messages can run.
9. Finalize counts, detected fields, current mapping, capped warnings, and the
   completion state.
10. Commit and emit an unthrottled final progress result.

The importer must not call `File.text()`, read the complete file into one
string, or construct an array containing every parsed row. PapaParse's nested
worker option remains disabled because parsing already occurs in the SQLite
worker.

Header normalization, empty-line handling, missing-cell filling, extra-cell
warnings, malformed-row warnings, and the warning cap retain the meaningful
behavior of the existing browser parser. The SQLite importer deliberately does
not apply the existing 500-row mobile cap.

If one file fails, its transaction is rolled back and later files may continue.
Earlier committed files remain available. The selected source `File` objects
are only read and are never modified.

## Cancellation and operation serialization

The worker has one active import record containing its import ID and a
cancellation flag. A matching `cancel-import` request only sets that flag; it
does not close SQLite or terminate the worker.

Cancellation requests bypass the serialized database-operation queue so the
worker can observe them while an asynchronous import is active. The importer
checks the flag only at safe chunk or insertion-batch boundaries. On a match it
pauses parsing, releases prepared statements, rolls back the active file, and
returns a normalized canceled result.

The rest of the database operations are serialized. They must not run while a
file transaction is open, because otherwise unrelated statements could become
part of that transaction. A second import waits for the active batch. Ordinary
invalid or failed requests do not terminate the worker.

Disposal is different from cancellation: disposing intentionally terminates the
worker and loses every dataset in that temporary session.

## Worker protocol

The main thread sends only this envelope:

```js
{
  requestId: "request-1",
  operation: "get-preview-page",
  payload: {
    datasetId: "dataset-id",
    offset: 0,
    limit: 30,
  },
}
```

The allowed worker operations are:

- `initialize`
- `import-files`
- `cancel-import`
- `get-dataset-summary`
- `set-dataset-enabled`
- `remove-dataset`
- `update-dataset-mapping`
- `get-preview-page`
- `close`

Success and failure responses correlate to one request:

```js
{ type: "response", requestId, ok: true, result }
{ type: "response", requestId, ok: false, error: { code, message } }
```

Progress is a separate event carrying the contract's import ID, state, safe file
name, file number, total files, and bounded counts. It never carries source
rows. Parsing and storing progress is throttled, while terminal progress is
always emitted.

Request validation rejects unknown operations, missing IDs, invalid file lists,
invalid dataset IDs, non-boolean visibility values, mapping fields not present
in the dataset headers, and invalid preview offsets or limits. Preview limits
have a fixed worker-side maximum even when a larger value is requested.

The protocol never accepts SQL, database bytes, database handles, URLs,
filesystem paths, Electron values, or arbitrary worker message types.

## Result and failure boundary

The worker returns small operation-specific results. The adapter converts them
through `dataSourceNormalization.js` before callers receive them.

Worker errors use stable internal codes but safe messages. Raw exception text,
SQL text, browser paths, stack traces, and worker implementation details do not
cross the adapter boundary. A worker load error, crash, or unexpected
termination rejects every outstanding request with a normalized
`backend-unavailable` failure that explains that the temporary session data was
lost.

Dataset summaries contain metadata only. Complete source rows cross the worker
boundary only through an explicitly requested, bounded preview page.

## Verification strategy

Implementation tests will cover the database/import core separately from the
worker transport, followed by a real browser-worker validation.

Required automated scenarios are:

- empty schema initialization;
- one successful file and multiple successful files;
- mixed successful and failed files;
- failed-file and canceled-file rollback;
- cancellation preserving earlier committed datasets;
- worker reuse after cancellation and ordinary request failure;
- header normalization, missing cells, extra cells, malformed rows, and capped
  warnings;
- coordinate and timeline detection;
- retention of rows without valid coordinates;
- stable source-row order and bounded preview pages;
- dataset summaries, visibility, mapping metadata, and removal;
- removal of the final dataset;
- invalid worker requests;
- throttled progress with an unthrottled terminal event; and
- worker restart producing an empty database.

A generated 30,000-row CSV will exercise the real incremental worker import.
The validation will record the stored count, approximate duration, responsive
progress, correct preview pages, and confirmation that complete rows are not
retained in main-thread application state. Large fixture data will be generated
at runtime rather than committed.

Final regression checks will include the existing browser parity, data-source,
desktop SQLite, lint, browser build, and desktop build commands. No performance
result from one development machine will become a brittle duration threshold.

## Architecture invariants

The implementation must preserve all of these conditions:

1. SQLite and complete source rows are owned by one dedicated worker.
2. The database is temporary and starts empty with every worker.
3. One file equals one transaction.
4. A failed or canceled file leaves no dataset or source rows behind.
5. A committed file is not affected by a later file's failure or cancellation.
6. Cancellation never terminates the shared worker.
7. Complete files are never accumulated as JavaScript strings or row arrays.
8. Complete rows reach the main thread only in bounded preview responses.
9. Normal database operations are serialized while an import transaction is active.
10. Worker messages expose named operations, not SQL or database handles.
11. The new adapter is not selected by the normal runtime in issue #104.
12. The current GitHub Pages browser workflow remains active.
13. Desktop SQLite behavior and schema remain unchanged.
