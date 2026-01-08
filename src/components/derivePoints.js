import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";
import { tryGetYear, tryParseDayOfYear } from "./timeline";

/**
 * Derive point features from CSV rows using chosen lat/lon fields.
 * Skips invalid rows and returns a summary.
 */
export function derivePointsFromCsv({
  rows,
  latField,
  lonField,
  timeline,
  timelineFields,
}) {
  const points = [];
  let skipped = 0;
  let skippedByTimeline = 0;

  if (!Array.isArray(rows) || !latField || !lonField) {
    return {
      points,
      skipped,
      skippedByTimeline,
      reason: "Missing rows or lat/lon mapping.",
    };
  }

  const timelineEnabled = !!timeline?.timelineEnabled;
  const dayEnabled = !!timeline?.dayFilterEnabled;

  const yearMin = timeline?.yearMin ?? null;
  const yearMax = timeline?.yearMax ?? null;

  const startYear = timeline?.startYear ?? yearMin;
  const endYear = timeline?.endYear ?? yearMax;

  const startDay = timeline?.startDay ?? 1;
  const endDay = timeline?.endDay ?? 365;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const lat = parseFlexibleFloat(r?.[latField]);
    const lon = parseFlexibleFloat(r?.[lonField]);

    if (!isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }

    // Timeline filtering (only when enabled)
    if (timelineEnabled) {
      const year = tryGetYear(r, timelineFields);
      if (year == null) {
        skippedByTimeline++;
        continue;
      }

      if (startYear != null && year < startYear) {
        skippedByTimeline++;
        continue;
      }
      if (endYear != null && year > endYear) {
        skippedByTimeline++;
        continue;
      }

      if (dayEnabled) {
        const doy = tryParseDayOfYear(r, timelineFields);
        if (doy == null) {
          skippedByTimeline++;
          continue;
        }

        const inRange =
          startDay <= endDay
            ? doy >= startDay && doy <= endDay
            : doy >= startDay || doy <= endDay;

        if (!inRange) {
          skippedByTimeline++;
          continue;
        }
      }
    }

    points.push({
      id: `${i}`,
      lat,
      lon,
      row: r,
    });
  }

  return { points, skipped, skippedByTimeline, reason: null };
}


