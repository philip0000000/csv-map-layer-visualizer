import { parseDateValue, parseYearValue } from "./timeline";

/**
 * Extract a year value from either a numeric year field or a date field.
 * Returns null when no usable value is present.
 */
export function getRangeYear(row, yearField, dateField) {
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

/**
 * Parse an order value. Return null so callers can fall back to row order.
 */
export function parseOrderValue(value) {
  const n = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Set a style value only once, using the first non-empty row value that can be parsed.
 */
export function applyFirstNonEmpty(target, key, value, parser) {
  if (target[key] != null && target[key] !== "") return;

  const raw = String(value ?? "").trim();
  if (!raw) return;

  const parsed = parser ? parser(raw) : raw;
  if (parsed == null || parsed === "") return;

  target[key] = parsed;
}
