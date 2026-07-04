import { getRangeYear } from "./csvFeatureValueHelpers";
import { tryGetYear } from "./timeline";

/**
 * Build a small timeline lookup from map features.
 * The index keeps only feature ids and year ranges, not full CSV rows.
 */
export function buildTimelineIndex({ features, getSourceRow, timelineFields, rangeFields }) {
  const entries = [];

  for (const feature of features ?? []) {
    const row = getSourceRow?.(feature?.sourceFileId, feature?.sourceRowIndex);
    const extent = getFeatureTimelineExtent(row, timelineFields, rangeFields);

    // Features without a usable date stay out of the timeline index.
    if (!extent) continue;

    entries.push({
      featureId: feature.id,
      startYear: extent.startYear,
      endYear: extent.endYear,
    });
  }

  return { entries };
}

/**
 * Return feature ids whose timeline range overlaps the selected year window.
 * Undated features are not returned because they are not in the index.
 */
export function getVisibleTimelineFeatureIds(timelineIndex, timeline) {
  const visibleIds = new Set();
  const startYear = timeline?.startYear ?? timeline?.yearMin ?? null;
  const endYear = timeline?.endYear ?? timeline?.yearMax ?? null;

  for (const entry of timelineIndex?.entries ?? []) {
    if (endYear != null && endYear < entry.startYear) continue;
    if (startYear != null && startYear > entry.endYear) continue;

    visibleIds.add(entry.featureId);
  }

  return visibleIds;
}

function getFeatureTimelineExtent(row, timelineFields, rangeFields) {
  // Prefer explicit ranges when the CSV has year/date from-to columns.
  const yearFrom = getRangeYear(
    row,
    rangeFields?.yearFromField,
    rangeFields?.dateFromField,
  );
  const yearTo = getRangeYear(
    row,
    rangeFields?.yearToField,
    rangeFields?.dateToField,
  );

  if (yearFrom != null || yearTo != null) {
    const from = yearFrom ?? yearTo;
    const to = yearTo ?? yearFrom;
    if (from == null || to == null) return null;

    return {
      startYear: Math.min(from, to),
      endYear: Math.max(from, to),
    };
  }

  // Fall back to a single year/date column.
  const year = tryGetYear(row, timelineFields);
  if (year == null) return null;

  return {
    startYear: year,
    endYear: year,
  };
}
