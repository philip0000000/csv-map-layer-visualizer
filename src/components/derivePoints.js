import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";

/**
 * Derive point features from CSV rows using chosen lat/lon fields.
 * Skips invalid rows and returns a summary.
 */
export function derivePointsFromCsv({ rows, latField, lonField }) {
  const points = [];
  let skipped = 0;

  if (!Array.isArray(rows) || !latField || !lonField) {
    return { points, skipped, reason: "Missing rows or lat/lon mapping." };
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const lat = parseFlexibleFloat(r?.[latField]);
    const lon = parseFlexibleFloat(r?.[lonField]);

    if (!isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }

    points.push({
      id: `${i}`,       // stable per file (index-based)
      lat,
      lon,
      row: r,           // original row data for popup
    });
  }

  return { points, skipped, reason: null };
}


