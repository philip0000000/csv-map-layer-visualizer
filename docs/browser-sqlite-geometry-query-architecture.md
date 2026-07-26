# Browser SQLite line and region architecture

Issue #106 extends the temporary browser SQLite backend with line and region
parity. It does not select that backend in the normal browser runtime. GitHub
Pages continues to use the in-memory data source, and desktop SQLite behavior is
unchanged.

## Geometry storage and indexing

`source_rows` remains authoritative for complete normalized CSV rows. Compact
line and region records live in `geometry_features`. Each record contains its
stable dataset and logical feature identity, optional region part, ordered
coordinates, resolved rendering style, line arrow mode, timeline extent,
detail source reference, and conservative latitude/longitude bounding box.

The geometry table is indexed by dataset, type, bounds, and timeline extent.
It never contains a complete source row. Foreign keys cascade from the selected
source row, so dataset removal cannot leave derived geometry behind.

## Derivation and ordering

Rebuilds step through source rows in original order and stage only valid line
and region vertices in a temporary SQLite table. SQLite then orders those
vertices by explicit numeric `order`, falling back to source-row index. Equal
sort keys use source-row index as the deterministic tie breaker. One geometry
group is held in JavaScript memory at a time.

Lines group by `featureId` and require two valid vertices. Regions group by
`featureId` and `part`, default an empty part to `0`, require three valid
vertices, and close rings when necessary. Stable output IDs include dataset ID,
logical feature ID, and region part where applicable.

Multipart regions share the first valid source row of their logical region for
details and timeline identity. Lines use the first vertex in resolved order.
This preserves the raw browser popup and timeline behavior.

## Style resolution and worker compatibility

Styles use the first usable value in resolved vertex order. Line weights are
rounded and clamped to 1 through 20, and arrows accept `none`, `start`, `end`,
or `both`. Region color/fill-color fallback and existing defaults are retained.

Workers do not expose the main-thread-only `CSS.supports` API. Line color
resolution therefore follows the existing helper's no-CSS fallback: any
trimmed non-empty color token is retained for the renderer. This deterministic
difference is covered by the geometry parity smoke test.

## Viewport and timeline queries

Geometry queries first intersect the requested dataset set with currently
enabled, completely imported datasets. SQLite applies latitude and longitude
bounding-box overlap and inclusive timeline overlap before records are
returned. Timeline-disabled queries include undated geometry; timeline-enabled
queries exclude it. Day-of-year state remains intentionally unapplied.

Wrapped viewports use the two longitude segments around the antimeridian.
Bounding boxes are conservative: false positives are acceptable, while lines
or polygons crossing the viewport cannot be missed merely because every vertex
is outside it.

Complete coordinate sequences are returned because Leaflet needs them to draw
the matching geometry. Complete source rows are not selected during viewport
work and are available only through explicit detail lookup.

## Dense geometry bounds

Lines and regions are not grouped. Their combined result is deterministically
limited by the normalized map render budget, defaulting to 1,000 and capped at
10,000. Point grouping retains its existing independent behavior. Query
statistics report matching and returned counts per geometry type, hidden
geometry count, the applied limit, and whether the limit was reached.

This means a response can contain the bounded point result plus the separately
bounded geometry result. The split deliberately avoids allowing a dense point
viewport to starve all lines and regions.

## Transaction and detail behavior

Import finalization derives points, lines, and regions before committing the
file transaction. Coordinate mapping updates rebuild all three feature types
inside one transaction. Any failure rolls back the new mapping and every
derived change, preserving the previous working state and leaving other
datasets untouched.

Exact detail lookup accepts only a stable source reference currently owned by a
derived point or geometry. It cannot expose arbitrary source-row or SQL access.
Removed datasets or references invalidated by remapping return the defined empty
detail result.
