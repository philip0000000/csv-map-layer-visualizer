import { useSessionStorageState } from "./useSessionStorageState";

const STORAGE_KEY = "csv-map-layer-visualizer.mapTools.v1";

const DEFAULT_STATE = {
  clusterMarkersEnabled: false,
  clusterRadius: 80,      // actual applied value
  clusterRadiusDraft: 80, // UI editing buffer
};

export function useMapToolsState() {
  const [state, setState] = useSessionStorageState(STORAGE_KEY, DEFAULT_STATE);

  function patch(partial) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  return { state, patch };
}


