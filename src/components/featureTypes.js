function normalizeKey(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "");
}

export function detectFeatureTypeField(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return null;

  for (const h of headers) {
    if (normalizeKey(h) === "featuretype") return h;
  }

  return null;
}

export function getRowFeatureType(row, featureTypeField) {
  if (!row || typeof row !== "object" || !featureTypeField) return null;

  const raw = row[featureTypeField];
  const value = String(raw ?? "").trim();
  if (!value) return null;

  return value.toLowerCase();
}
