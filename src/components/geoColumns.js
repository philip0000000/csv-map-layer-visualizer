const LAT_SYNONYMS = [
  "lat",
  "latitude",
  "y",
  "northing",
];

const LON_SYNONYMS = [
  "lon",
  "lng",
  "long",
  "longitude",
  "x",
  "easting",
];

function normalizeKey(h) {
  // "Latitude_2" -> "latitude"
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_\d+$/g, "");
}

function scoreHeader(normalized, synonyms) {
  // Prefer exact matches, then "contains" matches.
  // This helps with headers like "gps_latitude" etc.
  for (const s of synonyms) {
    if (normalized === s) return 100;
  }
  for (const s of synonyms) {
    if (normalized.includes(s)) return 50;
  }
  return 0;
}

function pickBest(headers, synonyms) {
  let best = { field: null, score: 0, index: -1 };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const n = normalizeKey(h);
    const s = scoreHeader(n, synonyms);

    if (s > best.score) best = { field: h, score: s, index: i };
  }

  return best.field;
}

export function autoDetectLatLon(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return { latField: null, lonField: null };
  }

  const latField = pickBest(headers, LAT_SYNONYMS);
  const lonField = pickBest(headers, LON_SYNONYMS);

  return {
    latField: latField ?? null,
    lonField: lonField ?? null,
  };
}

export function parseFlexibleFloat(value) {
  if (value === null || value === undefined) return NaN;

  // Handle numbers already
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;

  const s = String(value).trim();
  if (!s) return NaN;

  // Replace decimal comma with dot if it looks like a decimal comma.
  // Examples:
  // "59,3293" -> "59.3293"
  // "1 234,56" -> "1234.56"
  const normalized = s
    .replace(/\s+/g, "")     // remove spaces
    .replace(/,/g, ".");     // decimal comma -> dot (simple + effective)

  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function isValidLat(lat) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLon(lon) {
  return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}


