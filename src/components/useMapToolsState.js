import { useMemo, useState } from "react";

const DEFAULT_CLUSTER_RADIUS = 80;

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
