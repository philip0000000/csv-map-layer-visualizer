import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";
import { getRowFeatureType } from "./featureTypes";

const DEFAULT_IMAGE_SIZE_METERS = 100;
const MIN_IMAGE_SIZE_METERS = 1;
const MAX_IMAGE_SIZE_METERS = 100000;

/**
 * Derive point features from CSV rows using chosen lat/lon fields.
 */
export function derivePointsFromCsv({
  rows,
  latField,
  lonField,
  featureTypeField,
  idPrefix = "",
}) {
  const points = [];
  let skipped = 0;

  if (!Array.isArray(rows) || !latField || !lonField) {
    return {
      points,
      skipped,
      reason: "Missing rows or lat/lon mapping.",
    };
  }

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

    const stableId = idPrefix ? `${idPrefix}:${i}` : `${i}`;

    points.push({
      id: stableId, // TODO: make stable
      sourceRowIndex: i,
      lat,
      lon,
      latField,
      lonField,
      marker: r?.marker,
      image: resolvePointImage(r?.image),
      imageWidthMeters: parseImageSizeMeters(r?.imageWidthMeters),
      imageHeightMeters: parseImageSizeMeters(r?.imageHeightMeters),
    });
  }

  return { points, skipped, reason: null };
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
