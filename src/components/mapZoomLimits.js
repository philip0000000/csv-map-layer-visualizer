export const FALLBACK_MAP_MAX_ZOOM = 20;
export const INITIAL_MAP_MAX_ZOOM = 19;

/** Use a background's finite limit when available, otherwise keep map navigation bounded. */
export function getEffectiveMapMaxZoom(configuredMaxZoom) {
  return Number.isFinite(configuredMaxZoom) ? configuredMaxZoom : FALLBACK_MAP_MAX_ZOOM;
}
