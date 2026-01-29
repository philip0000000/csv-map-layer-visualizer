import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";
import {
  parseDateValue,
  parseYearValue,
  tryGetYear,
  tryParseDayOfYear,
} from "./timeline";
import { getRowFeatureType } from "./featureTypes";

const DEFAULT_STYLE = {
  color: "#3388ff",
  weight: 2,
  opacity: 1,
  fillColor: "#3388ff",
  fillOpacity: 0.25,
};

/**
 * Derive region polygons from CSV rows using chosen lat/lon fields.
 * Regions are grouped by featureId and part.
 */
export function deriveRegionsFromCsv({
  rows,
  latField,
  lonField,
  timeline,
  timelineFields,
  rangeFields,
  featureTypeField,
}) {
  const polygons = [];
  let skipped = 0;
  let skippedByTimeline = 0;

  if (!Array.isArray(rows) || !latField || !lonField) {
    return {
      polygons,
      skipped,
      skippedByTimeline,
      reason: "Missing rows or lat/lon mapping.",
    };
  }

  if (!featureTypeField) {
    return { polygons, skipped, skippedByTimeline, reason: null };
  }

  const timelineEnabled = !!timeline?.timelineEnabled;
  const dayEnabled = !!timeline?.dayFilterEnabled;

  const yearMin = timeline?.yearMin ?? null;
  const yearMax = timeline?.yearMax ?? null;

  const startYear = timeline?.startYear ?? yearMin;
  const endYear = timeline?.endYear ?? yearMax;

  const startDay = timeline?.startDay ?? 1;
  const endDay = timeline?.endDay ?? 365;

  const groups = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const featureType = getRowFeatureType(row, featureTypeField);

    if (featureType !== "region") continue;

    if (timelineEnabled) {
      const visible = isRowVisibleForTimeline({
        row,
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

    const featureId = String(row?.featureId ?? "").trim();
    if (!featureId) {
      skipped++;
      continue;
    }

    const partRaw = String(row?.part ?? "").trim();
    const part = partRaw ? partRaw : "0";

    const lat = parseFlexibleFloat(row?.[latField]);
    const lon = parseFlexibleFloat(row?.[lonField]);

    if (!isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }

    const orderValue = parseOrderValue(row?.order);

    if (!groups.has(featureId)) {
      groups.set(featureId, {
        parts: new Map(),
        firstPartKey: part,
        popupRow: null,
      });
    }

    const group = groups.get(featureId);

    if (!group.parts.has(part)) {
      group.parts.set(part, { rows: [] });
    }

    if (!group.popupRow && group.firstPartKey === part) {
      group.popupRow = row;
    }

    group.parts.get(part).rows.push({
      row,
      lat,
      lon,
      orderValue,
      index: i,
    });
  }

  for (const [featureId, group] of groups.entries()) {
    for (const [part, partGroup] of group.parts.entries()) {
      const sorted = partGroup.rows
        .slice()
        .sort((a, b) => getOrderKey(a) - getOrderKey(b));

      if (sorted.length < 3) continue;

      const coordinates = sorted.map((r) => [r.lat, r.lon]);
      if (coordinates.length < 3) continue;

      if (!isRingClosed(coordinates)) {
        coordinates.push(coordinates[0]);
      }

      const style = resolveStyle(sorted);

      polygons.push({
        id: `${featureId}:${part}`,
        featureId,
        part,
        coordinates,
        row: group.popupRow ?? sorted[0]?.row ?? null,
        style,
      });
    }
  }

  return { polygons, skipped, skippedByTimeline, reason: null };
}

function parseOrderValue(value) {
  const n = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function getOrderKey(item) {
  return item.orderValue ?? item.index;
}

function isRingClosed(coords) {
  if (!coords.length) return true;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function resolveStyle(rows) {
  const style = {};

  for (const { row } of rows) {
    applyFirstNonEmpty(style, "color", row?.color);
    applyFirstNonEmpty(style, "weight", row?.weight, parseNumber);
    applyFirstNonEmpty(style, "opacity", row?.opacity, parseNumber);
    applyFirstNonEmpty(style, "fillColor", row?.fillColor);
    applyFirstNonEmpty(style, "fillOpacity", row?.fillOpacity, parseNumber);
  }

  const hasColor = Object.prototype.hasOwnProperty.call(style, "color");
  const hasFillColor = Object.prototype.hasOwnProperty.call(style, "fillColor");

  const resolved = { ...DEFAULT_STYLE, ...style };

  if (!hasFillColor && resolved.color) {
    resolved.fillColor = resolved.color;
  }

  if (!hasColor && resolved.fillColor) {
    resolved.color = resolved.fillColor;
  }

  return resolved;
}

function applyFirstNonEmpty(target, key, value, parser) {
  if (target[key] != null && target[key] !== "") return;

  const raw = String(value ?? "").trim();
  if (!raw) return;

  const parsed = parser ? parser(raw) : raw;
  if (parsed == null || parsed === "") return;

  target[key] = parsed;
}

function parseNumber(value) {
  const n = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function isRowVisibleForTimeline({
  row,
  timelineFields,
  rangeFields,
  startYear,
  endYear,
  startDay,
  endDay,
  dayEnabled,
}) {
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

    if (endYear != null && endYear < rangeStart) return false;
    if (startYear != null && startYear > rangeEnd) return false;

    return true;
  }

  const year = tryGetYear(row, timelineFields);
  if (year == null) return false;

  if (startYear != null && year < startYear) return false;
  if (endYear != null && year > endYear) return false;

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
