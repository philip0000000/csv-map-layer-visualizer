import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";
import { getRowFeatureType } from "./featureTypes";
import { isRowVisibleForTimeline } from "./timelineVisibility";

const DEFAULT_IMAGE_SIZE_METERS = 100;
const MIN_IMAGE_SIZE_METERS = 1;
const MAX_IMAGE_SIZE_METERS = 100000;

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
  idPrefix = "",
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
      const visible = isRowVisibleForTimeline({
        row: r,
        timelineFields,
        rangeFields,
        startYear,
        endYear,
        startDay,
        endDay,
        dayEnabled,
      });

      if (!visible) {
        skippedByTimeline++;
        continue;
      }
    }

    const stableId = idPrefix ? `${idPrefix}:${i}` : `${i}`;

    points.push({
      id: stableId, // TODO: make stable
      lat,
      lon,
      latField,
      lonField,
      marker: r?.marker,
      image: resolvePointImage(r?.image),
      imageWidthMeters: parseImageSizeMeters(r?.imageWidthMeters),
      imageHeightMeters: parseImageSizeMeters(r?.imageHeightMeters),
      row: r,
    });
  }

  return { points, skipped, skippedByTimeline, reason: null };
}

function resolvePointImage(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `/point-images/${trimmed}`;
}

function parseImageSizeMeters(value) {
  const parsed = parseFlexibleFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_IMAGE_SIZE_METERS;

  return Math.min(MAX_IMAGE_SIZE_METERS, Math.max(MIN_IMAGE_SIZE_METERS, parsed));
}
