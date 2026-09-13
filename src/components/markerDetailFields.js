export function buildMarkerDetailFields(
  row,
  latField,
  lonField,
  limit = 30,
) {
  if (!row || typeof row !== 'object') return [];

  // Point details show coordinates in their header; lines and zones omit individual vertex coordinates.
  const keys = Object.keys(row).filter(
    (key) => key !== latField && key !== lonField,
  );

  return keys.slice(0, limit).map((key) => [key, row[key]]);
}
