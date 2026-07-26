import {
  parseDateValue,
  parseYearValue,
} from '../../components/timeline.js';

/**
 * Resolve the inclusive year extent used by browser-SQLite features.
 *
 * Explicit from/to fields take precedence over single-value fields. A missing
 * side of a range reuses the available side, matching the raw browser timeline
 * index. Null means the feature is undated and is excluded only when timeline
 * filtering is enabled.
 *
 * @param {Record<string, unknown>} row Original normalized source row.
 * @param {Record<string, unknown>} fields Detected timeline field metadata.
 * @returns {{ startYear: number, endYear: number }|null} Inclusive year extent.
 */
export function getBrowserSqliteTimelineExtent(row, fields) {
  const yearFrom = getRangeYear(
    row,
    normalizeNullableString(fields.yearFromField),
    normalizeNullableString(fields.dateFromField),
  );
  const yearTo = getRangeYear(
    row,
    normalizeNullableString(fields.yearToField),
    normalizeNullableString(fields.dateToField),
  );

  if (yearFrom != null || yearTo != null) {
    const first = yearFrom ?? yearTo;
    const last = yearTo ?? yearFrom;
    return {
      startYear: Math.min(first, last),
      endYear: Math.max(first, last),
    };
  }

  const year = getRangeYear(
    row,
    normalizeNullableString(fields.yearField),
    normalizeNullableString(fields.dateField),
  );
  return year == null ? null : { startYear: year, endYear: year };
}

function getRangeYear(row, yearField, dateField) {
  if (yearField) {
    const year = parseYearValue(row[yearField]);
    if (year != null) return year;
  }
  if (dateField) {
    const date = parseDateValue(row[dateField]);
    if (date) return date.getUTCFullYear();
  }
  return null;
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}
