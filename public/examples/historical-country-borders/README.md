# Historical Country Borders

This folder is a copy-ready example dataset for csv-map-layer-visualizer.
Load every `historical-country-borders-*.csv` data shard to use the
complete dataset. Files ending in `.sources.csv` are matching source files
and are not map layers.

## Contents

- Border CSVs use the final csv-map-layer-visualizer input format.
- Each border CSV has a matching `.sources.csv` source file.
- `historical-country-border-sources.csv` describes upstream sources.
- `ATTRIBUTION.md` records citations and modifications.
- `LICENSE.md` records the distribution license.

## Shards

The build target is at most 40 MiB per data shard.
A feature is always kept whole; no `featureId` is divided between shards.

| Data file | Matching source file | Territories | Rows | Bytes |
| --- | --- | ---: | ---: | ---: |
| `historical-country-borders-africa-001.csv` | `historical-country-borders-africa-001.sources.csv` | 292 | 139264 | 28610390 |
| `historical-country-borders-americas-001.csv` | `historical-country-borders-americas-001.sources.csv` | 73 | 158052 | 32045375 |
| `historical-country-borders-asia-001.csv` | `historical-country-borders-asia-001.sources.csv` | 146 | 230837 | 41827422 |
| `historical-country-borders-asia-002.csv` | `historical-country-borders-asia-002.sources.csv` | 67 | 48469 | 10005511 |
| `historical-country-borders-europe-001.csv` | `historical-country-borders-europe-001.sources.csv` | 281 | 272556 | 28249646 |
| `historical-country-borders-oceania-001.csv` | `historical-country-borders-oceania-001.sources.csv` | 31 | 31279 | 6722998 |

## Attribution

See `ATTRIBUTION.md` and `historical-country-border-sources.csv`.
The upstream license is non-commercial and share-alike; review
`LICENSE.md` before redistribution or use.
