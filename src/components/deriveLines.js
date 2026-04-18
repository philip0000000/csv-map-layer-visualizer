import { isValidLat, isValidLon, parseFlexibleFloat } from "./geoColumns";
import {
  parseDateValue,
  parseYearValue,
  tryGetYear,
  tryParseDayOfYear,
} from "./timeline";
import { getRowFeatureType } from "./featureTypes";

const DEFAULT_LINE_STYLE = {
  color: "#3388ff",
  weight: 3,
};

const MIN_WEIGHT = 1;
const MAX_WEIGHT = 20;

const ALLOWED_ARROW_MODES = new Set(["none", "start", "end", "both"]);

/**
 * Derive line features from CSV rows using chosen lat/lon fields.
 *
 * Input model (CSV):
 * - Each line vertex is one row.
 * - Rows with featureType=line are grouped by featureId.
 * - Vertex order uses numeric `order` when present, file order otherwise.
 */
export function deriveLinesFromCsv({
  rows,
  latField,
  lonField,
  timeline,
  timelineFields,
  rangeFields,
  featureTypeField,
  idPrefix = "",
}) {
  const lines = [];
  let skipped = 0;
  let skippedByTimeline = 0;

  if (!Array.isArray(rows) || !latField || !lonField) {
    return {
      lines,
      skipped,
      skippedByTimeline,
      reason: "Missing rows or lat/lon mapping.",
    };
  }

  if (!featureTypeField) {
    return { lines, skipped, skippedByTimeline, reason: null };
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

    if (featureType !== "line") continue;

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

    const lat = parseFlexibleFloat(row?.[latField]);
    const lon = parseFlexibleFloat(row?.[lonField]);

    if (!isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }

    const orderValue = parseOrderValue(row?.order);

    if (!groups.has(featureId)) {
      groups.set(featureId, { rows: [] });
    }

    groups.get(featureId).rows.push({
      row,
      lat,
      lon,
      orderValue,
      index: i,
    });
  }

  for (const [featureId, group] of groups.entries()) {
    const sorted = group.rows
      .slice()
      .sort((a, b) => getOrderKey(a) - getOrderKey(b));

    if (sorted.length < 2) continue;

    const coordinates = sorted.map((r) => [r.lat, r.lon]);
    if (coordinates.length < 2) continue;

    const style = resolveLineStyle(sorted);
    const arrow = resolveArrowMode(sorted);
    const id = idPrefix ? `${idPrefix}:${featureId}` : featureId;

    lines.push({
      id,
      featureId,
      coordinates,
      style,
      arrow,
      // Use first sorted row for popup metadata.
      row: sorted[0]?.row ?? null,
    });
  }

  return { lines, skipped, skippedByTimeline, reason: null };
}

function parseOrderValue(value) {
  const n = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function getOrderKey(item) {
  return item.orderValue ?? item.index;
}

function resolveLineStyle(rows) {
  const style = {};

  // First non-empty style value wins for the full line.
  for (const { row } of rows) {
    applyFirstNonEmpty(style, "color", row?.color, parseColor);
    applyFirstNonEmpty(style, "weight", row?.weight, parseWeight);
  }

  return { ...DEFAULT_LINE_STYLE, ...style };
}

function resolveArrowMode(rows) {
  // First valid arrow value wins for the full line.
  for (const { row } of rows) {
    const raw = String(row?.arrow ?? "").trim().toLowerCase();
    if (!raw) continue;
    if (ALLOWED_ARROW_MODES.has(raw)) return raw;
  }

  return "none";
}

function applyFirstNonEmpty(target, key, value, parser) {
  if (target[key] != null && target[key] !== "") return;

  const raw = String(value ?? "").trim();
  if (!raw) return;

  const parsed = parser ? parser(raw) : raw;
  if (parsed == null || parsed === "") return;

  target[key] = parsed;
}

function parseWeight(value) {
  const n = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(n)) return null;

  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, Math.round(n)));
}

function parseColor(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return trimmed;
  }

  return CSS.supports("color", trimmed) ? trimmed : null;
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
