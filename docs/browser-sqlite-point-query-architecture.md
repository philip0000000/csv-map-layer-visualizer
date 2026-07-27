# Browser SQLite point-query architecture


> Historical design note: this document records the issue #105 implementation
> stage. Issue #108 later made SQLite WASM the exclusive browser path; see
> [SQLite data-source architecture](./browser-sqlite-ui-integration.md).
Issue #105 adds point derivation and query operations to the temporary browser
SQLite backend. It does not select that backend in the normal browser runtime;
the existing GitHub Pages data path and desktop SQLite implementation remain
unchanged.

## Storage boundary

`source_rows` remains the authoritative store for complete normalized CSV rows.
The `point_features` table contains only the stable source reference,
coordinates, timeline extent, and compact presentation JSON needed by map
queries. Its composite foreign key cascades from `source_rows`, so dataset
removal cannot leave derived records behind.

Import finalization builds point records before committing the file transaction.
Coordinate remapping updates metadata and rebuilds only the affected dataset in
one transaction. A failed rebuild therefore preserves both the previous mapping
and its working derived records.

Rows with invalid point coordinates remain available in `source_rows`. Rows
explicitly marked for another feature type are not counted as invalid points and
are reserved for later line and region work.

## Query behavior

Viewport queries resolve the enabled dataset set once, then apply bounds and
timeline overlap in SQLite before counting or grouping. Wrapped Leaflet bounds
use the two longitude segments on either side of the antimeridian. Timeline
filtering uses inclusive year-range overlap; disabled timeline state includes
undated points, while enabled state excludes them. Day-of-year state remains
intentionally unapplied, preserving the browser parity decision from issue
#103.

Results at or below the render budget are exact and ordered by dataset and
source-row index. Dense results use a deterministic viewport-relative grid and
choose the first dataset/source row in each occupied cell as the representative.
Viewport responses never select or return `row_json`.

## Details and group paging

Exact details accept only a stable dataset/source-row reference and join the
derived point to its original source row and current coordinate mapping.

Every grouped result captures its originating bounds, normalized timeline,
enabled dataset snapshot, grid cell, and stable sort order. Group paging uses
that captured context rather than current map or visibility state, defaults to
30 rows, and is capped at 100 rows per worker response. Removed datasets and
points invalidated by later remapping naturally disappear because paging joins
the current derived table back to `source_rows`.

## Worker boundary

The worker protocol exposes only three additional named operations:

- `query-map-view`
- `get-feature-details`
- `get-group-rows`

Their payloads are strictly validated and cannot contain SQL, database handles,
or unrestricted row filters. All operations use the worker's existing serialized
database queue, and complete rows cross the worker boundary only through an
explicit detail or bounded paging request.
