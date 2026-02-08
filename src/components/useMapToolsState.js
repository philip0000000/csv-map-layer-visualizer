import { useMemo, useState } from "react";

const DEFAULT_CLUSTER_RADIUS = 80;

function getInitialStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const exampleValues = params.getAll("example");

  // Only enable clustering by default when example is present AND looks like a CSV filename.
  const hasValidExample = exampleValues.some((value) => {
    const trimmed = String(value ?? "").trim();
    return /^[a-zA-Z0-9._-]+\.csv$/.test(trimmed);
  });

  return {
    clusterMarkersEnabled: hasValidExample, // true only for ?example=valid.csv
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

