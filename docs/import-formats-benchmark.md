# Import format comparison

Measured on 2026-10-04 in this Windows workspace with Node 24.19.0 and sql.js
1.14.1. This exercises the browser SQLite importer in isolated Node processes,
not a browser UI or desktop performance measurement. Each case ran once from a
local file; timings exclude conversion/compression and SQL.js initialization.
Peak RSS includes the Node runtime, WASM database, input Blob, and import work.
It is whole-process peak resident memory, not JavaScript heap size. Results vary
with hardware, caches, geometry, metadata, and network conditions.

The bundled Fornsök files were read without alteration. The originals contain
42,061,663 bytes of lines and 96,381,424 bytes of regions. Samples contain the
first approximately 100,000 vertex rows; the final boundary feature is removed
to avoid partial geometry. Actual samples contain 99,998 line vertices and
99,987 region vertices. Samples are regenerated with ordinary CSV escaping;
their sizes do not represent the entire original bundles.

The importer/exporter generates equivalent compact CSV and standalone GeoJSON
in temporary files for this comparison. Generated properties retain legacy CSV
coordinate/structural columns as well as custom metadata, so the comparison does
not gain size reductions by deleting metadata. No simplification or precision
rounding occurs. One degenerate legacy region part cannot satisfy GeoJSON's
four-position closed-ring requirement: legacy input renders 20,543 region parts,
whereas the exported representations contain 20,542. Export reports that omission.
All line representations contain 12,446 lines.

Each cell below lists **plain / gzip** results. "Usable" is import completion
plus the first worldwide viewport query with a render budget of 1,000; the app
does not expose the provisional file before completion.

| Sample / layout | Size MiB | Import seconds | Usable seconds | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Lines, legacy CSV | 6.05 / 1.17 | 4.355 / 7.756 | 4.415 / 7.812 | 269 / 194 |
| Lines, compact CSV | 4.82 / 0.98 | 2.803 / 5.894 | 2.837 / 5.937 | 158 / 172 |
| Lines, GeoJSON | 7.11 / 1.09 | 4.398 / 4.255 | 4.435 / 4.292 | 317 / 241 |
| Regions, legacy CSV | 5.82 / 1.47 | 4.394 / 7.785 | 4.442 / 7.843 | 263 / 188 |
| Regions, compact CSV | 6.38 / 1.60 | 4.106 / 8.143 | 4.158 / 8.194 | 226 / 183 |
| Regions, GeoJSON | 9.13 / 1.76 | 6.032 / 5.861 | 6.079 / 5.906 | 324 / 306 |

Compact CSV reduced the line sample by 20.3%, but increased the region sample
by 9.6%. Many short region parts make JSON syntax and retained per-feature
metadata significant. GeoJSON was larger than legacy CSV in both samples.
Gzip reduced sizes by roughly 75–85%; it did not consistently reduce import time.
The streaming CSV route and decompression add CPU work even where memory is lower.
This is evidence for offering optional formats, not for automatically converting
existing bundles or assuming one layout is best for every dataset.

Run `npm run benchmark:import-formats` from the repository root to reproduce the
comparison. Set `CSV_MAP_BENCHMARK_REPORT` to save raw JSON results. Each import
case has a 60-second timeout. Only generated temporary files are removed.
The checked-in [raw measurements](import-formats-benchmark.json) include exact
byte sizes, source/feature counts, timings in milliseconds, and RSS values.

Full-bundle imports, real browser tab memory, and native desktop timings remain
manual performance checks; these representative samples are not full-bundle
performance guarantees.
