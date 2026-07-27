# csv-map-layer-visualizer

Browser SQLite test-mode instructions: [Browser SQLite UI integration](docs/browser-sqlite-ui-integration.md).

A client side web app for visualizing CSV based geodata on an interactive world map.
It is designed for datasets where entries represent real world things or events that happened at a place and time, and where a timeline helps explore how the data changes over years.

Built with **React (client-side)** + **Vite**, using **Leaflet** with **OpenStreetMap** tiles. CSV parsing is done locally in the browser using **PapaParse**.

## Live demo

Empty app (upload your own CSV):

https://philip0000000.github.io/csv-map-layer-visualizer/

Demo with example data (auto-loaded):

https://philip0000000.github.io/csv-map-layer-visualizer/?example=books.csv

You can repeat the `example` parameter to load more than one example file.

## Example data

The repository contains example CSV files in:

public/examples/

`books.csv` is a small example dataset of book-related locations used for demonstration.

## Data sources

Some example datasets (e.g. medieval Swedish cities) are derived from Wikipedia and are licensed under CC BY-SA 4.0.

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

The app works with CSV files that contain geographic data such as points and regions.

Minimum required:
- latitude column
- longitude column

Optional:
- `featureType` for geometry type
- timeline-related columns such as `year`, `date`, `yearFrom`, `yearTo`, `dateFrom`, `dateTo`
- `marker` for custom point markers
- region-related columns such as `featureId`, `part`, and `order`

For full format details, supported columns, notes, and examples, see:
- [CSV format documentation](docs/csv-format.md)

## Getting started (development)

### Prerequisites
- Node.js (recent LTS recommended)

### Install & run
```bash
npm install
npm run dev
```

Then open the URL printed in the terminal (usually http://localhost:5173).

### Desktop run
```bash
npm run desktop:start
```

This launches the current app in the Electron desktop shell. It does not create a standalone executable or installer yet.

For more details, see [Desktop runtime decision](docs/desktop-runtime.md).

## Author

Developed and maintained by **philip0000000**.
