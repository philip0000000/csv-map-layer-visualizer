function normalizeKey(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "")
    .replace(/\d+$/g, "");
}

const YEAR_SYNONYMS = ["year", "yyyy", "yr", "ar", "år"]; // keep simple
const DATE_SYNONYMS = ["date", "datetime", "timestamp", "time", "created", "createdat"];
const DOY_SYNONYMS = ["dayofyear", "doy", "yearday"];

function scoreHeader(normalized, synonyms) {
  for (const s of synonyms) {
    if (normalized === s) return 100;
  }
  for (const s of synonyms) {
    if (normalized.includes(s)) return 50;
  }
  return 0;
}

function pickBest(headers, synonyms) {
  let best = { field: null, score: 0 };
  for (const h of headers) {
    const n = normalizeKey(h);
    const s = scoreHeader(n, synonyms);
    if (s > best.score) best = { field: h, score: s };
  }
  return best.field;
}

export function autoDetectTimelineFields(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return { yearField: null, dateField: null, dayOfYearField: null };
  }

  const yearField = pickBest(headers, YEAR_SYNONYMS);
  const dateField = pickBest(headers, DATE_SYNONYMS);
  const dayOfYearField = pickBest(headers, DOY_SYNONYMS);

  return {
    yearField: yearField ?? null,
    dateField: dateField ?? null,
    dayOfYearField: dayOfYearField ?? null,
  };
}

export function autoDetectRangeFields(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return {
      yearFromField: null,
      yearToField: null,
      dateFromField: null,
      dateToField: null,
    };
  }

  return {
    yearFromField: findExactKey(headers, "yearfrom"),
    yearToField: findExactKey(headers, "yearto"),
    dateFromField: findExactKey(headers, "datefrom"),
    dateToField: findExactKey(headers, "dateto"),
  };
}

function findExactKey(headers, normalizedKey) {
  for (const h of headers) {
    if (normalizeKey(h) === normalizedKey) return h;
  }
  return null;
}

/**
 * Try to get a usable year for a row.
 * Order:
 * 1) yearField if detected
 * 2) parse from dateField if detected
 *
 * Returns integer year or null.
 */
export function tryGetYear(row, fields) {
  if (!row || typeof row !== "object") return null;

  const yearField = fields?.yearField ?? null;
  const dateField = fields?.dateField ?? null;

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
 * Day-of-year:
 * - If explicit dayOfYearField exists, use it (1..365)
 * - Else parse dateField and compute day-of-year
 *
 * Returns integer 1..365 or null.
 */
export function tryParseDayOfYear(row, fields) {
  if (!row || typeof row !== "object") return null;

  const doyField = fields?.dayOfYearField ?? null;
  const dateField = fields?.dateField ?? null;

  if (doyField) {
    const n = parseIntSafe(row[doyField]);
    if (n != null && n >= 1 && n <= 365) return n;
    return null;
  }

  if (dateField) {
    const d = parseDateValue(row[dateField]);
    if (!d) return null;

    // Compute day-of-year in UTC
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    const current = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const day = Math.floor((current - start) / 86400000) + 1;

    // Requirement: keep slider 1-365, no leap-year UI
    if (day >= 1 && day <= 365) return day;
    return null;
  }

  return null;
}

export function parseYearValue(v) {
  if (v == null) return null;

  if (typeof v === "number" && Number.isFinite(v)) {
    const y = Math.trunc(v);
    return isReasonableYear(y) ? y : null;
  }

  const s = String(v).trim();
  if (!s) return null;

  // Accept: "2020", "2020.0", "2020-01-01" (will take first 4 digits)
  const m = s.match(/-?\d{3,4}/);
  if (!m) return null;

  const y = Number.parseInt(m[0], 10);
  return isReasonableYear(y) ? y : null;
}

function isReasonableYear(y) {
  // wide range for historical data (matches your example)
  return Number.isFinite(y) && y >= -2000 && y <= 3000;
}

export function parseDateValue(v) {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;

  // If numeric: treat as unix ms if large; unix seconds if smaller
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
    if (ms != null) {
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  const s = String(v).trim();
  if (!s) return null;

  // ISO-like should parse reliably
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  // Try common "YYYY-MM-DD" or "YYYY/MM/DD"
  const m = s.match(/^(-?\d{3,4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    const y = Number.parseInt(m[1], 10);
    const mo = Number.parseInt(m[2], 10);
    const da = Number.parseInt(m[3], 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
    const dt = new Date(Date.UTC(y, mo - 1, da));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

function parseIntSafe(v) {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

