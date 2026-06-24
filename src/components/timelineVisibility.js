import { tryGetYear, tryParseDayOfYear } from "./timeline";
import { getRangeYear } from "./csvFeatureValueHelpers";

export function isRowVisibleForTimeline({
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

    if (from == null || to == null) {
      return false;
    }

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
