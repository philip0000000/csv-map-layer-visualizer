# CSV format

This app reads CSV files and maps rows to map features.

## Coordinates

Every row needs valid latitude and longitude values.

Common column names:

- `lat`, `latitude`
- `lon`, `lng`, `longitude`

## Lines

Use `featureType=line` to build one polyline from many CSV rows.

### Required line fields

- `featureType` must be `line`
- `featureId` groups rows into one line
- latitude field
- longitude field

### Optional line fields

- `order`: point order inside the line (low to high)
- `color`: line color
- `weight`: line width in pixels (rounded and clamped to 1..20)
- `arrow`: arrow mode

Supported `arrow` values:

- `none`
- `start`
- `end`
- `both`

Rules:

- A line is grouped by `featureId`.
- Rows are sorted by `order`, then file row order.
- At least 2 valid coordinates are needed to render a line.

### Line example CSV

```csv
featureType,featureId,order,lat,lon,name,color,weight,arrow
line,routeA,1,59.33,18.06,Trade route,#ff0000,4,end
line,routeA,2,59.40,18.20,Trade route,#ff0000,4,end
line,routeA,3,59.52,18.45,Trade route,#ff0000,4,end
```
