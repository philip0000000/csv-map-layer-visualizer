/** Parse a complete, safely representable whole year; reject unfinished input. */
export function parseWholeYear(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const year = Number(text);
  return Number.isSafeInteger(year) ? year : null;
}

/** Recover missing saved edges, clamp the edited year, and push the opposite edge if crossed. */
export function commitTimelineYear(range, boundary, value) {
  const year = parseWholeYear(value);
  if (year == null) return null;
  const { yearMin, yearMax, startYear, endYear } = range;
  if (![yearMin, yearMax].every(Number.isSafeInteger)
    || yearMin > yearMax) return null;

  // Older sessions could save empty edges. The edited edge is replaced below;
  // an empty opposite edge falls back to its corresponding timeline limit.
  const previousStart = startYear ?? yearMin;
  const previousEnd = endYear ?? yearMax;
  const oppositeYear = boundary === "startYear" ? previousEnd : previousStart;
  if (!Number.isSafeInteger(oppositeYear)) return null;

  const nextYear = Math.max(yearMin, Math.min(yearMax, year));
  // Return both edges so inputs, slider, and map receive one ordered range.
  if (boundary === "startYear") {
    return { startYear: nextYear, endYear: Math.max(nextYear, Math.min(yearMax, previousEnd)) };
  }
  return { startYear: Math.min(nextYear, Math.max(yearMin, previousStart)), endYear: nextYear };
}
