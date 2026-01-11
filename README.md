# csv-map-layer-visualizer

A client side web app for visualizing CSV based geodata on an interactive world map.
It is designed for datasets where entries represent real world things or events that happened at a place and time, and where a timeline helps explore how the data changes over years.

Built with **React (client-side)** + **Vite**, using **Leaflet** with **OpenStreetMap** tiles. CSV parsing is done locally in the browser using **PapaParse**.

---

## What it does

- Import **one or more CSV files** in the browser
- Auto detect likely **latitude/longitude** columns (with manual override)
- Plot rows as **map points**
- Click a point to see more detail from it
- Optional **timeline filtering** (year range when date fields exist)

---

## Scope and non-goals (for now)

This project focuses on **visualizing user provided CSV rows as geographic features** on a map, with a timeline oriented workflow. Everything is client side processing. 

---

## CSV expectations

Minimum required:
- Two columns that represent coordinates:
  - Latitude in `[-90..90]`
  - Longitude in `[-180..180]`

Recommended:
- A time-related column to enable timeline filtering. The app will try to detect:
  - `year` (e.g. `Year`, `yr`, etc.)
  - `date/datetime` (e.g. `date`, `timestamp`, `createdAt`)
  - `day-of-year` (e.g. `doy`, `dayOfYear`)

Notes:
- CSV parsing is intentionally tolerant. Bad rows may be skipped and warnings surfaced in the UI.
- Decimal comma coordinates (e.g. `59,3293`) are supported.

---

## Getting started (development)

### Prerequisites
- Node.js (recent LTS recommended)

### Install & run
```bash
npm install
npm run dev
```

Then open the URL printed in the terminal (usually http://localhost:5173).

---

## Embedding

The long term goal is for the app to be embeddable in other web pages.

Currently, it runs as a standalone Vite built client application. A dedicated embeddable build/package does not exist yet.

## Author

Developed and maintained by **philip0000000**.
