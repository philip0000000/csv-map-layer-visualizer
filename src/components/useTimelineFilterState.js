import { useSessionStorageState } from "./useSessionStorageState";

const STORAGE_KEY = "csv-map-layer-visualizer.timeline.v1";

const DEFAULT_STATE = {
  timelineEnabled: false,

  // Computed domain from data (set when timeline is enabled)
  yearMin: null,
  yearMax: null,

  // Selected range
  startYear: null,
  endYear: null,

  // Optional day filter
  dayFilterEnabled: false,
  startDay: 1,
  endDay: 365,

  // UI-only: "More filters" expander
  moreFiltersOpen: false,
};

export function useTimelineFilterState() {
  const [state, setState] = useSessionStorageState(STORAGE_KEY, DEFAULT_STATE);

  function patch(partial) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  function setYearDomain(yearMin, yearMax) {
    setState((prev) => ({
      ...prev,
      yearMin: yearMin ?? null,
      yearMax: yearMax ?? null,
    }));
  }

  function setYearRange(startYear, endYear) {
    setState((prev) => ({
      ...prev,
      startYear: startYear ?? null,
      endYear: endYear ?? null,
    }));
  }

  function setDayRange(startDay, endDay) {
    setState((prev) => ({
      ...prev,
      startDay: clampInt(startDay, 1, 365),
      endDay: clampInt(endDay, 1, 365),
    }));
  }

  return {
    state,
    patch,
    setYearDomain,
    setYearRange,
    setDayRange,
  };
}

function clampInt(n, min, max) {
  const x = Number.parseInt(n, 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}


