# CSV format documentation

This document describes the CSV structure supported by `csv-map-layer-visualizer`, including coordinates, feature types, timeline fields, point markers, point images, line definitions, and region definitions.

## CSV expectations

Minimum required:
- Two columns that represent coordinates:
  - Latitude in `[-90..90]`
  - Longitude in `[-180..180]`

Feature types:
- `featureType` column can be used to choose the geometry:
  - `point` (default; marker or image rendering)
  - `line`
  - `region`
- If the `featureType` column is missing, rows are treated as `point` for backward compatibility.

Recommended:
- Time related columns to enable timeline filtering:
  - Point-in-time:
    - `year` (preferred; fastest and most predictable)
    - `date` (supports full dates or year only values like `-2100`)
  - Time range:
    - `yearFrom` / `yearTo`
    - `dateFrom` / `dateTo`
  - Optional day-of-year:
    - `doy`, `dayOfYear`

Notes:
- Years may be negative (BCE) and are supported in the range -10000 to 10000.
- A `date` value that contains only a year (example: `-2100`) is interpreted as January 1 of that year (UTC).
- When both `year` and `date` exist, `year` is used for timeline filtering.
- ISO date formats (`YYYY-MM-DD`) are recommended for best compatibility.
- CSV parsing is intentionally tolerant. Bad rows may be skipped and warnings surfaced in the UI.
- Decimal comma coordinates (e.g. `59,3293`) are supported.
- A single CSV file may contain a mix of feature types (`point`, `line`, and `region`) as long as it uses one shared header row. Columns that do not apply to a given row may be left empty.
- If no time column is detected, timeline filtering is disabled.

## Points

Point rows use `featureType=point` (or omit `featureType`).

### Marker field

Optional `marker` customizes the point marker.

Best for:
- emoji
- text labels
- small icons

Examples:
- `🏰`
- `⭐⛪`
- `A`
- `Castle`

Marker image values are also supported for fixed-size marker icons when the value:
- starts with `/`
- starts with `http://` or `https://`
- ends with `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`, `.gif`

Relative filenames such as `castle.png` resolve to:

```text
/icons/castle.png
````

Recommended local marker icon folder:

```text
/public/icons/
```

Missing, blank, or whitespace-only marker values fall back to the default Leaflet marker.

If a custom marker image fails to load, the default Leaflet marker is used.

### Geographic image field

Optional `image` renders the point as a map-scaled image instead of a marker.

Best for:

* buildings
* ships
* trees
* illustrations
* historical assets
* large visual objects

When `image` is present:

* `marker` is ignored
* image stays anchored to the point
* image grows when zooming in
* image shrinks when zooming out
* image uses real map size in meters

Supported values:

* filename: `castle.png`
* relative path: `/point-images/castle.png`
* full URL: `https://example.com/castle.png`

Filename-only values resolve to:

```text
/point-images/castle.png
```

Recommended local image folder:

```text
/public/point-images/
```

Optional size fields:

* `imageWidthMeters`
* `imageHeightMeters`

Defaults:

```text
100 x 100 meters
```

Valid range for each size:

```text
1 to 100000 meters
```

Tips:

* For maintainability, larger datasets are typically easier to manage when split into separate files (e.g. one for points and one for regions), but mixed files are supported.

## Lines

Line rows use `featureType=line`.

Lines are rendered as connected polylines.
Each vertex is one row. Rows with `featureType=line` are grouped by `featureId`.
The vertex order uses the `order` column if present (otherwise file order is used).

Required columns (for line rows):

* `featureType` = `line`
* `featureId` = logical line id
* latitude + longitude columns

Optional columns:

* `order` = vertex order (number; optional but recommended)
* `name` = display name
* `color` = line color
* `weight` = line thickness in pixels
* `arrow` = arrowhead mode

Supported `arrow` values:

* `none`
* `start`
* `end`
* `both`

Notes:

* A valid line needs at least 2 valid coordinates.
* If `arrow` is missing or invalid, it falls back to `none`.
* `weight` is screen-space pixel width, not meters.
* Line thickness follows normal Leaflet polyline behavior.
* Clicking a line opens a popup using the same general metadata pattern as points and regions.
* Lines support timeline filtering in the same way as points and regions.

Example (basic line):

```csv
featureType,featureId,order,lat,lon,name,color,weight,arrow
line,routeA,1,59.33,18.06,Trade route,#ff0000,4,end
line,routeA,2,59.40,18.20,Trade route,#ff0000,4,end
line,routeA,3,59.52,18.45,Trade route,#ff0000,4,end
line,routeA,4,59.61,18.70,Trade route,#ff0000,4,end
```

Example (double-arrow line):

```csv
featureType,featureId,order,lat,lon,name,color,weight,arrow
line,migration,1,58.90,17.90,Migration route,#0088ff,3,both
line,migration,2,59.10,18.30,Migration route,#0088ff,3,both
line,migration,3,59.45,18.90,Migration route,#0088ff,3,both
```

## Regions (polygons)

Regions may represent borders, zones, or areas of influence (e.g. political, cultural, linguistic).
Each vertex is one row. Rows with `featureType=region` are grouped by `featureId`,
and optionally `part` for multi-part regions. The vertex order uses the `order` column
if present (otherwise file order is used). Rings are auto-closed if needed.

Required columns (for region rows):

* `featureType` = `region`
* `featureId` = logical region id
* latitude + longitude columns

Optional columns:

* `part` = sub-part id for multi-part regions (defaults to `0`)
* `order` = vertex order (number; optional but recommended)
* `name` = display name
* Style columns (first non-empty per part):

  * `color`, `weight`, `opacity`, `fillColor`, `fillOpacity`

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

Example (custom point markers):

```csv
featureType,lat,lon,marker,name
point,59.3,18.0,🏰,Castle
point,59.4,18.1,A,Town
```

Example (map-scaled point images):

```csv
featureType,lat,lon,name,image,imageWidthMeters,imageHeightMeters
point,59.3293,18.0686,Castle,castle.png,400,250
point,59.35,18.09,Ship,ship.png,800,300
```

Example (lines):

```csv
featureType,featureId,order,lat,lon,name,color,weight,arrow
line,routeA,1,59.33,18.06,Trade route,#ff0000,4,end
line,routeA,2,59.40,18.20,Trade route,#ff0000,4,end
line,routeA,3,59.52,18.45,Trade route,#ff0000,4,end
```
