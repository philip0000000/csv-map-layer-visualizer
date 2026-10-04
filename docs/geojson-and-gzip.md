# GeoJSON and gzip imports

The browser and desktop file pickers, file drops, and `?example=` links accept
`.csv`, `.csv.gz`, `.geojson`, and `.geojson.gz`. Each gzip file contains one
document. Existing CSV files continue to work; conversion is optional. See
[CSV conventions](csv-format.md) for existing columns, styles, and timeline rules.

## Compact CSV

An optional `geometry` cell contains a GeoJSON geometry or complete Feature. A
whole line or polygon occupies one row. For example:

```csv
name,color,geometry
Route,#ff0000,"{""type"":""LineString"",""coordinates"":[[18,59],[19,60]]}"
```

JSON uses longitude, latitude, and optional altitude. Coordinate order determines
vertex order; precision is retained. Polygon rings must already be closed, with
the outer ring first and holes afterward. Multipart geometry and mixed
GeometryCollections are supported. Legacy vertex rows retain their existing
grouping, sorting, and automatic closure rules and can coexist with compact rows.

Geometry takes precedence over CSV coordinate fields. For an embedded Feature,
valid recognized `properties` override matching CSV values; absent or invalid
values fall back to CSV, then application defaults. Geometry-only cells obtain
metadata from the CSV columns. Arbitrary nested properties retain their JSON types.
Styles inside geometry objects remain foreign metadata and do not control rendering.

Empty cells and ordinary custom text in `geometry` retain legacy interpretation.
An identifiable but malformed GeoJSON cell is skipped with a warning, without
falling back to CSV coordinates. Conflicting CSV `featureType` values are also
skipped. Use the optional `geometryInterpretation` column with `legacy` to force
ordinary custom-column interpretation, or `geojson` to require GeoJSON. The default
is automatic detection. These two control columns are excluded from compact
CSV-derived Feature properties on GeoJSON export; properties embedded inside a
Feature with the same names remain ordinary custom data.

## Standalone GeoJSON

FeatureCollections, individual Features, and standalone geometries are accepted.
All seven geometry types are supported. Inputs use WGS84 geographic coordinates;
projected coordinates are not reprojected or guessed. Longitude must be between
−180 and 180 and latitude between −90 and 90. Only optional altitude is accepted
after those two coordinates. Ring winding is accepted in either direction.

Feature IDs retain their string or numeric types. Duplicate IDs do not merge
features. Internal selection identifies the parent source row and component;
datasets remain independent. Point and line components in a mixed collection
remain unchanged when the region tools transform its polygons and holes together.
Only existing region editing is provided; edits preserve collection structure,
component order, altitude, properties, and precision. Existing bounding boxes are
recalculated after edits; map bounds always come from the coordinates.

`properties: null` and `geometry: null` are accepted. Non-spatial features remain
in the preview/export without map shapes. Custom properties, nested objects and
arrays, and foreign members are preserved. Details show nested JSON as serialized
JSON. Recognized properties follow the existing CSV conventions: names, timeline
fields, point markers/images/image sizes, stroke/fill styles, and line arrows.
These are application conventions, not GeoJSON styling standards.

Native custom properties named `geometry`, `geometryInterpretation`, or
`featureType` remain in the authoritative Feature. In the CSV preview/export,
`geometry` instead contains that complete Feature and `geometryInterpretation`
identifies it as GeoJSON. This preserves colliding original names within the
Feature without overwriting them with generated data. A native `featureType`
property is metadata and does not redefine its geometry.

## Export

Right-click a dataset to choose **Save as CSV** or **Save as GeoJSON**. GeoJSON
export is an uncompressed FeatureCollection containing current edited geometry.
Native Features preserve IDs, JSON property types, multipart shapes, holes,
altitude, and foreign members. Collection foreign members are also retained.
Legacy line vertices become a LineString; legacy region parts become polygons
or a MultiPolygon. They do not become holes, which the legacy layout cannot express.
Legacy grouping IDs become exported Feature IDs.
Geometry-only compact CSV also uses its optional `featureId` as the exported
Feature ID. A complete embedded Feature retains its own ID without adding one.
Degenerate legacy polygon parts with fewer than four closed-ring positions cannot
be represented by RFC 7946; GeoJSON export omits them and reports a warning. CSV
export still retains those source rows.

CSV-derived metadata remains strings, including coordinate and structural
columns; it is not automatically coerced to numbers or booleans. When legacy
vertex metadata differs, lines use their first ordered vertex; regions share the
first source vertex's metadata, with later vertices filling blank values. Export
uses the map's resolved style values, represented as CSV strings. Differently
styled region parts become separate Polygon Features with the original Feature
ID; equally styled parts remain a MultiPolygon. Custom property names are retained.
Replayable file inputs permit bounded root-type lookahead. A type member after
features may require reading/decompressing the file twice, but the collection
still streams without buffering all its Features.

CSV export serializes nested objects/arrays as JSON cells with normal CSV quote
escaping. Scalar values appear as text and null as an empty cell. CSV alone cannot
distinguish, for example, numeric `1` from string `"1"`, or null from an empty
string. For native/compact Features the retained full Feature in `geometry`
preserves those distinctions for reimport. Use GeoJSON export for a typed round trip.
Gzip export is not included.

## Large files and failures

Reading, decompression, and parsing are incremental. Source rows are stored in
bounded batches; complete expanded documents are not retained as text. A single
Feature or coordinate array still needs memory proportional to its size. JSON
features/tokens and unfinished CSV records are limited to 64 Mi characters;
GeoJSON and gzip browser inputs, and streamed desktop inputs, are limited to
2 GiB expanded UTF-8 bytes. Ordinary browser CSV retains its existing PapaParse
file-slice path. GeoJSON geometry nesting
is limited to 64 levels (JSON document nesting to 128). These are practical limits,
not a promise that every device can import a file of the maximum size. The browser
also retains its SQLite database in memory; desktop uses persistent SQLite.

Progress shows reading/expanded bytes for streamed inputs and parsed/stored row
counts. Canceling or a fatal document/gzip error rolls back the active file.
Independent files committed before a failure remain imported. Recoverable invalid
rows/features generate bounded warnings. No geometry simplification or coordinate
rounding is applied. A malformed individual Feature may be skipped; malformed
document syntax or a damaged gzip trailer discards the entire active dataset.

Gzip reliably targets storage/transfer size, not faster parsing. Compact layouts
reduce repeated vertex metadata, but JSON syntax and short shapes can make files
larger. See [measured comparisons](import-formats-benchmark.md).
