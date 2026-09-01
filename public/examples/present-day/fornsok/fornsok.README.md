# Fornsök example data

This folder contains large browser-oriented CSV datasets derived from open data published by **Riksantikvarieämbetet (Swedish National Heritage Board)** through **Fornsök / Kulturmiljöregistret**.

The files are prepared as example and stress-test datasets for `csv-map-layer-visualizer`.

## Files

| File | Contents | Logical features | Approx. size |
| --- | --- | ---: | ---: |
| `fornsok_points.csv` | Point geometries | 531,432 points | 89.34 MiB |
| `fornsok_lines.csv` | Line geometries | 81,424 lines | 39.49 MiB |
| `fornsok_regions.csv` | Polygon geometries converted to visualization regions | 225,930 regions | 90.16 MiB |

These are intentionally large nationwide datasets.

## Performance recommendation

The Fornsök examples are much larger than ordinary CSV examples and can require substantial browser memory while parsing and rendering.

For comfortable use of the full nationwide datasets, a practical recommendation is:

- **16 GB RAM or more**
- a reasonably modern multi-core CPU
- a current 64-bit browser
- an otherwise normally capable desktop or laptop

Machines with less memory may still work, especially when loading one dataset at a time, but the large region dataset or several datasets loaded together can cause heavy memory pressure, long pauses, browser tab crashes, or temporary system sluggishness.

The exact requirements depend on the browser, operating system, other open applications, and which datasets are loaded.

## Source

Source organization:

**Riksantikvarieämbetet (Swedish National Heritage Board)**

Source dataset:

**Kulturhistoriska lämningar / Fornsök / Kulturmiljöregistret**

Source snapshot date:

**2026-08-31**

Original nationwide source file:

`lämningar_sverige.gpkg`

Official source pages:

- https://app.raa.se/open/fornsok/
- https://catalog.raa.se/store/1/resource/217
- https://www.raa.se/hitta-information/oppna-data/

The original GeoPackage uses:

**SWEREF 99 TM (EPSG:3006)**

Coordinates in these derived CSV files were transformed to:

**WGS 84 (EPSG:4326)**

for ordinary latitude/longitude use in `csv-map-layer-visualizer`.

## Rights, attribution, and third-party material

Riksantikvarieämbetet states in the official product description for **Kulturhistoriska lämningar** that the dataset is **not covered by copyright and is free to use (Public Domain)**.

Riksantikvarieämbetet also asks reusers to identify **Riksantikvarieämbetet** as the source. When redistributing the information, the source and extraction/snapshot date should be stated because Kulturmiljöregistret is continuously updated.

Accordingly, this derived dataset identifies:

- source: **Riksantikvarieämbetet**
- source snapshot: **2026-08-31**

These CSV files are processed derivatives of the Public Domain source data. They are not an official Riksantikvarieämbetet product, and this project is not affiliated with or endorsed by Riksantikvarieämbetet.

The use of the names **Fornsök**, **Kulturmiljöregistret**, and **Riksantikvarieämbetet** in this folder is solely to identify the source and subject of the data.

### Linked material

Some CSV values link back to records in Fornsök.

A linked Fornsök record may itself refer to photographs, reports, documents, or other material with separate copyright or licensing conditions. The Public Domain status of the downloadable cultural-remains dataset should **not** be interpreted as automatically applying to every image, report, document, or third-party resource linked from a Fornsök record.

Check the rights or licence information attached to the individual resource before copying or redistributing such material.

These example CSV files contain links to Fornsök records; they do not intentionally republish the linked photographs or reports.

## Points

`fornsok_points.csv` contains all **531,432 point geometries** present in the downloaded source point layer.

The dataset was reduced to fields useful for visualization:

- `lat`
- `lon`
- `marker`
- `name`
- `lamningsnummer`
- `lamningstyp`
- `antikvariskbedomning`
- `fornsok`

The `marker` field contains an emoji derived from the registered `lamningstyp` so broad categories are easier to distinguish visually on the map.

The emoji is only a visualization aid. The original `lamningstyp` field is retained and should be used when the registered classification matters.

The `fornsok` field links back to the corresponding record published by Riksantikvarieämbetet.

## Lines

`fornsok_lines.csv` contains:

- **81,424 logical line geometries**
- **658,158 line vertices**

Each line is represented by multiple CSV rows sharing the same `featureId`.

To reduce file size, descriptive metadata is stored on the first row of each logical line rather than duplicated for every vertex.

Vertex order is preserved by CSV row order.

## Regions

`fornsok_regions.csv` contains all **225,930 logical polygon regions** from the source polygon layer.

No logical source polygon region was intentionally removed.

The original source contained approximately **4.8 million exterior polygon vertices**. The final browser-oriented CSV contains approximately **1.84 million region vertex rows**.

The region geometry has therefore been deliberately simplified to make nationwide browser visualization and normal GitHub distribution practical.

The simplification process was designed to:

- retain every logical region
- preserve small and simple regions
- preserve many significant angular boundary features
- preferentially remove redundant or low-importance boundary vertices
- simplify very detailed boundaries more aggressively
- keep the resulting file below GitHub's normal 100 MiB file-size limit

Because of this simplification, the region layer is a **visualization-oriented approximation** of the source geometry.

### Interior holes

The source polygon layer contains:

- **283 polygons with one or more interior holes**
- **357 interior holes**
- **7,023 source interior-ring vertices**

These interior holes are represented in the final CSV.

The affected source polygons are converted into multiple `part` polygons sharing the same logical `featureId`. Together, those parts represent the surrounding region while leaving the source interior area empty.

This multipart representation can produce visible internal boundary seams in some map styles because individual parts may each receive an outline. Those seams are a rendering consequence of the CSV representation and are not additional archaeological boundaries.

### Accuracy warning

The derived region layer must **not** be treated as authoritative, survey-accurate, or suitable for determining exact archaeological boundaries.

Riksantikvarieämbetet notes that the quality of open cultural-heritage information can vary and advises against using the information as the sole basis for detailed planning or ground works.

For current, precise, legal, planning, excavation, or land-use questions, consult the current Fornsök record, the original data published by Riksantikvarieämbetet, and the relevant responsible authority.

## Data freshness

This folder contains a **frozen example snapshot from 2026-08-31**.

It is not automatically synchronized with the live Kulturmiljöregistret.

Kulturmiljöregistret is continuously updated, so records, classifications, descriptions, and geometries in current Fornsök may differ from these example CSV files.

The supplied `fornsok` links should be used to inspect the current published record when freshness matters.

## Intended use

These files are intended for:

- demonstrating large CSV datasets in `csv-map-layer-visualizer`
- browser map visualization
- software and performance testing
- experimentation with Swedish cultural-heritage open data
- demonstrating points, lines, regions, multipart regions, and large nationwide datasets

They are **not** intended to replace Fornsök or the authoritative source dataset.

For authoritative and current cultural-environment information, use Riksantikvarieämbetet / Fornsök directly.
