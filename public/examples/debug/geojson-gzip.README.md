# GeoJSON and gzip debug datasets

- `geojson-all-geometries.geojson`: all seven geometry types, polygon holes,
  multipart shapes, a mixed collection, altitude, typed/nested properties, and
  a non-spatial Feature sharing another Feature's ID. Expect 12 rendered parts
  and one retained non-spatial Feature. Disable timeline filtering to see everything.
- `compact-geometry-mixed.csv`: equivalent compact shapes plus an ordinary CSV
  point. Its embedded line Feature overrides the CSV color; its invalid embedded
  year falls back to the CSV year. The dummy CSV coordinates must not override
  compact geometry. Expect 13 rendered parts with timeline filtering disabled.
- `compact-geometry-invalid.csv`: one usable point and three invalid compact
  rows. Expect three warnings; invalid geometry must not fall back to coordinates.

Import via the file picker/drop or a URL such as
`?example=debug/geojson-all-geometries.geojson`.

For compressed tests, gzip each document individually, retaining its extension:
`compact-geometry-mixed.csv.gz` or `geojson-all-geometries.geojson.gz`.
ZIP, 7z, TAR, and `.tar.gz` packages are not supported. Renaming an archive does
not turn it into gzip. In 7-Zip, choose **Archive format: gzip**, with one input
file selected. Compressed and original files should produce equivalent datasets.

Test region edits on the mixed collection: polygon outlines and holes should move
together while its point and line remain unchanged. Export as GeoJSON and reimport
to check geometry, altitude, and nested properties. The deliberately invalid CSV
is for warning/rollback checks, not a geometry equivalence comparison.
