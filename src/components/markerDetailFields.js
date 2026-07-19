export function buildMarkerDetailFields(
  row,
  latField,
  lonField,
  limit = 30,
) {
  if (!row || typeof row !== 'object') return [];

  // Coordinates are rendered separately at the top of marker details.
  const keys = Object.keys(row).filter(
    (key) => key !== latField && key !== lonField,
  );

  return keys.slice(0, limit).map((key) => [key, row[key]]);
}
