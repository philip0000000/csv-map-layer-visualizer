import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";
import { parseDateValue, parseYearValue, tryGetYear, tryParseDayOfYear } from "./timeline";
import { getRowFeatureType } from "./featureTypes";

/**
 * Derive point features from CSV rows using chosen lat/lon fields.
 * Supports both point-in-time and time-range timeline filtering.
 */
export function derivePointsFromCsv({
  rows,
  latField,
  lonField,
  timeline,
  timelineFields,
  rangeFields,
  featureTypeField,
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
    const featureType = getRowFeatureType(r, featureTypeField);

    if (featureType && featureType !== "point") continue;

    const lat = parseFlexibleFloat(r?.[latField]);
    const lon = parseFlexibleFloat(r?.[lonField]);

    if (!isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }

    if (timelineEnabled) {
      const vis = isPointVisibleForTimeline({
        row: r,
        timelineFields,
        rangeFields,
        startYear,
        endYear,
        startDay,
        endDay,
        dayEnabled,
      });

      if (!vis) {
        skippedByTimeline++;
        continue;
      }
    }

    points.push({
      id: `${i}`, // TODO: make stable
      lat,
      lon,
      row: r,
    });
  }

  return { points, skipped, skippedByTimeline, reason: null };
}

function isPointVisibleForTimeline({
  row,
  timelineFields,
  rangeFields,
  startYear,
  endYear,
  startDay,
  endDay,
  dayEnabled,
}) {
  // 1) Prefer range semantics when a range exists
  const yearFrom = getRangeYear(row, rangeFields?.yearFromField, rangeFields?.dateFromField);
  const yearTo = getRangeYear(row, rangeFields?.yearToField, rangeFields?.dateToField);

  const hasRange = yearFrom != null || yearTo != null;

  if (hasRange) {
    const from = yearFrom ?? yearTo;
    const to = yearTo ?? yearFrom;
    if (from == null || to == null) return false;

    const rangeStart = Math.min(from, to);
    const rangeEnd = Math.max(from, to);

    // Visible if the range intersects the selected window
    if (endYear != null && endYear < rangeStart) return false;
    if (startYear != null && startYear > rangeEnd) return false;

    // Day-of-year filtering for ranges is undefined in your model;
    // keep behavior simple: do NOT apply day filter to ranges.
    return true;
  }

  // 2) Fall back to point-in-time year/date
  const year = tryGetYear(row, timelineFields);
  if (year == null) return false;

  if (startYear != null && year < startYear) return false;
  if (endYear != null && year > endYear) return false;

  // 3) Optional day-of-year filter only makes sense for point-in-time
  if (dayEnabled) {
    const doy = tryParseDayOfYear(row, timelineFields);
    if (doy == null) return false;

    const inRange =
      startDay <= endDay
        ? doy >= startDay && doy <= endDay
        : doy >= startDay || doy <= endDay;

    if (!inRange) return false;
  }

  return true;
}

function getRangeYear(row, yearField, dateField) {
  if (!row || typeof row !== "object") return null;

  if (yearField) {
    const y = parseYearValue(row[yearField]);
    if (y != null) return y;
  }

  if (dateField) {
    const d = parseDateValue(row[dateField]);
    if (d) return d.getUTCFullYear();
  }

  return null;
}


