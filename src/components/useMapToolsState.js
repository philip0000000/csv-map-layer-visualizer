import { useMemo, useState } from "react";

const DEFAULT_CLUSTER_RADIUS = 80;

function getInitialState() {
  return {
    clusterMarkersEnabled: true,
    clusterRadius: DEFAULT_CLUSTER_RADIUS,
    clusterRadiusDraft: DEFAULT_CLUSTER_RADIUS,
  };
}

export function useMapToolsState() {
  // Initialize ONCE on first render (no persistence)
  const initial = useMemo(() => getInitialState(), []);
  const [state, setState] = useState(initial);

  function patch(partial) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  return { state, patch };
}
