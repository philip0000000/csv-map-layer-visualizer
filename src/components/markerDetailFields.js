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

  // Typed GeoJSON metadata may contain arrays/objects; show their JSON rather than [object Object].
  return keys.slice(0, limit).map((key) => [key,
    row[key] === null ? 'null' : typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key]]);
}
