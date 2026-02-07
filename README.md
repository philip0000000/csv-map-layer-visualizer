# csv-map-layer-visualizer

A client side web app for visualizing CSV based geodata on an interactive world map.
It is designed for datasets where entries represent real world things or events that happened at a place and time, and where a timeline helps explore how the data changes over years.

Built with **React (client-side)** + **Vite**, using **Leaflet** with **OpenStreetMap** tiles. CSV parsing is done locally in the browser using **PapaParse**.

## Live demo

Empty app (upload your own CSV):

https://philip0000000.github.io/csv-map-layer-visualizer/

Demo with example data (auto-loaded):

https://philip0000000.github.io/csv-map-layer-visualizer/?example=books.csv

## Example data

The repository contains example CSV files in:

public/examples/

`books.csv` is a small example dataset of book-related locations used for demonstration.

## What it does

- Import **one or more CSV files** in the browser
- Auto detect likely **latitude/longitude** columns (with manual override)
- Plot rows as **map points**
- Render CSV-defined **regions (polygons)**
- Click a point to see more detail from it
- Optional **timeline filtering** (based on point-in-time or time-range fields)

## Scope

This project focuses on **visualizing user provided CSV rows as geographic features** on a map, with a timeline oriented workflow. Everything is client side processing. 

## CSV expectations

Minimum required:
- Two columns that represent coordinates:
  - Latitude in `[-90..90]`
  - Longitude in `[-180..180]`

Feature types:
- `featureType` column can be used to choose the geometry:
  - `point` (default)
  - `region`
  - `line` (planned)
- If the `featureType` column is missing, rows are treated as `point` for backward compatibility.

Recommended:
- Time-related columns to enable timeline filtering:
  - Point-in-time: `year`, `date`
  - Time range: `yearFrom` / `yearTo`, `dateFrom` / `dateTo`
  - Optional day-of-year: `doy`, `dayOfYear`

Notes:
- CSV parsing is intentionally tolerant. Bad rows may be skipped and warnings surfaced in the UI.
- Decimal comma coordinates (e.g. `59,3293`) are supported.
- A single CSV file may contain a mix of feature types (`point`, `region`, and later `line`) as long as it uses one shared header row. Columns that do not apply to a given row may be left empty.

Tips:
- For maintainability, larger datasets are typically easier to manage when split into separate files (e.g. one for points and one for regions), but mixed files are supported.

### Regions (polygons)

Regions may represent borders, zones, or areas of influence (e.g. political, cultural, linguistic).
Each vertex is one row. Rows with `featureType=region` are grouped by `featureId`,
and optionally `part` for multi-part regions. The vertex order uses the `order` column
if present (otherwise file order is used). Rings are auto-closed if needed.

Required columns (for region rows):
- `featureType` = `region`
- `featureId` = logical region id
- `order` = vertex order (number; optional but recommended)
- latitude + longitude columns

Optional columns:
- `part` = sub-part id for multi-part regions (defaults to `0`)
- `name` = display name
- Style columns (first non-empty per part):
  - `color`, `weight`, `opacity`, `fillColor`, `fillOpacity`

Example (multi-part region):

```csv
featureType,featureId,part,order,lat,lon,name,color,fillOpacity
region,russia,main,1,55.7,37.6,Russia,#ff0000,0.15
region,russia,main,2,56.2,38.1,Russia,#ff0000,0.15
region,russia,kaliningrad,1,54.7,20.5,Russia,#ff0000,0.15
region,russia,kaliningrad,2,54.8,21.2,Russia,#ff0000,0.15
```

Example (points with featureType):

```csv
featureType,lat,lon,title,year
point,48.8,2.3,Some Book,1300
```

## Getting started (development)

### Prerequisites
- Node.js (recent LTS recommended)

### Install & run
```bash
npm install
npm run dev
```

Then open the URL printed in the terminal (usually http://localhost:5173).

## Embedding

The long term goal is for the app to be embeddable in other web pages.

Currently, it runs as a standalone Vite built client application. A dedicated embeddable build/package does not exist yet.

## Author

Developed and maintained by **philip0000000**.
