import { useMemo, useState } from "react";

const DEFAULT_CLUSTER_RADIUS = 80;

function getInitialStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const example = params.get("example");

  // Only enable clustering by default when example is present AND looks like a CSV filename.
  const isValidExample =
    typeof example === "string" && /^[a-zA-Z0-9._-]+\.csv$/.test(example.trim());

  return {
    clusterMarkersEnabled: isValidExample, // true only for ?example=valid.csv
    clusterRadius: DEFAULT_CLUSTER_RADIUS,
    clusterRadiusDraft: DEFAULT_CLUSTER_RADIUS,
  };
}

export function useMapToolsState() {
  // Initialize ONCE on first render (no persistence)
  const initial = useMemo(() => getInitialStateFromUrl(), []);
  const [state, setState] = useState(initial);

  function patch(partial) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  return { state, patch };
}


