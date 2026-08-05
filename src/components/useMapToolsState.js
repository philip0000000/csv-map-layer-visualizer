import { useMemo, useState } from "react";

export const MIN_CLUSTER_RADIUS = 0;
export const MAX_CLUSTER_RADIUS = 300;
export const DEFAULT_CLUSTER_RADIUS = 80;

/**
 * Convert an editable radius value into the integer accepted by marker clustering.
 * Zero is intentionally valid: it clusters exact coordinate matches while leaving
 * nearby markers with different coordinates separate.
 */
export function normalizeClusterRadius(raw, fallback = DEFAULT_CLUSTER_RADIUS) {
  let radius = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(radius)) {
    radius = fallback;
  }

  // Preserve zero's exact-coordinate behavior while enforcing the existing upper limit.
  return Math.max(MIN_CLUSTER_RADIUS, Math.min(MAX_CLUSTER_RADIUS, radius));
}

/** Create the shared, non-persisted default state used by every runtime mode. */
export function getInitialMapToolsState() {
  return {
    clusterMarkersEnabled: false,
    clusterRadius: DEFAULT_CLUSTER_RADIUS,
    clusterRadiusDraft: DEFAULT_CLUSTER_RADIUS,
  };
}

export function useMapToolsState() {
  // Initialize ONCE on first render (no persistence)
  const initial = useMemo(() => getInitialMapToolsState(), []);
  const [state, setState] = useState(initial);

  function patch(partial) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  return { state, patch };
}
