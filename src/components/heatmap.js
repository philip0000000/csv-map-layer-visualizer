export const DEFAULT_HEAT_RADIUS = 25;
export const MIN_HEAT_RADIUS = 5;
export const MAX_HEAT_RADIUS = 100;
export const HEAT_BLUR = 15;
export const HEAT_MAX_INTENSITY = 10;
export const HEAT_GRADIENT = {
  0.2: '#2563eb',
  0.5: '#22c55e',
  0.75: '#facc15',
  1: '#dc2626',
};

/** Retain completed timeline frames, but never heat from hidden or mutated datasets. */
export function getCurrentHeatPoints(mapState, contextKey, datasetIds) {
  return mapState.heatContextKey === contextKey && datasetIds.length > 0 && !mapState.error
    ? mapState.result?.points ?? [] : [];
}

/** Normalize a pixel radius to the integer range supported by the slider and renderer. */
export function normalizeHeatRadius(raw, fallback = DEFAULT_HEAT_RADIUS) {
  const radius = Number.parseInt(String(raw ?? '').trim(), 10);
  return Math.max(MIN_HEAT_RADIUS, Math.min(MAX_HEAT_RADIUS,
    Number.isFinite(radius) ? radius : fallback));
}

/** Preserve original record counts independently of visual marker clustering. */
export function toHeatContributions(points = []) {
  return points.flatMap((point) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return [];
    const summarized = point.renderType === 'grouped' || point.renderType === 'representative';
    const weight = summarized ? point.count : 1;
    if (!Number.isFinite(weight) || weight <= 0) return [];
    // Summaries intentionally retain their existing representative coordinates.
    return [[point.lat, point.lon, weight]];
  });
}

/** Keep the colour scale fixed across datasets, viewport queries and timeline frames. */
export function getHeatOptions(radius) {
  return {
    radius: normalizeHeatRadius(radius),
    blur: HEAT_BLUR,
    max: HEAT_MAX_INTENSITY,
    // Disable the plugin's map-maxZoom attenuation: one record has the same
    // contribution at every zoom; screen-space overlap still changes on zoom.
    maxZoom: 0,
    minOpacity: 0.01,
    gradient: HEAT_GRADIENT,
  };
}
