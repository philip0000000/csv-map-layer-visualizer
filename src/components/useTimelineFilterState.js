import { useEffect } from "react";
import { useSessionStorageState } from "./useSessionStorageState";

const STORAGE_KEY = "csv-map-layer-visualizer.timeline.v1";

const DEFAULT_STATE = {
  timelineEnabled: false,

  yearDomainMode: "auto",  // "auto" | "manual"
  yearMinDraft: "",
  yearMaxDraft: "",

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

  // Timeline playback settings
  playback: {
    isPlaying: false,
    stepYears: 1,
    intervalMs: 1000,
    moveStartWithEnd: false,
  },
};

export function useTimelineFilterState() {
  const [state, setState] = useSessionStorageState(STORAGE_KEY, DEFAULT_STATE);

  useEffect(() => {
    // Keep old saved state compatible with new playback fields.
    const nextPlayback = {
      ...DEFAULT_STATE.playback,
      ...(state?.playback ?? {}),
    };

    const samePlayback =
      state?.playback?.isPlaying === nextPlayback.isPlaying &&
      state?.playback?.stepYears === nextPlayback.stepYears &&
      state?.playback?.intervalMs === nextPlayback.intervalMs &&
      state?.playback?.moveStartWithEnd === nextPlayback.moveStartWithEnd;

    if (samePlayback) return;

    setState((prev) => ({
      ...prev,
      playback: {
        ...DEFAULT_STATE.playback,
        ...(prev?.playback ?? {}),
      },
    }));
  }, [state?.playback, setState]);

  function patch(partial) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  /*
   * Sets the computed year domain (data-derived bounds).
   *
   * NOTE:
   * This helper is kept for backward compatibility, but is no longer used by App.jsx.
   * The current implementation updates only `yearMin/yearMax` and does NOT:
   * - update `yearMinDraft/yearMaxDraft`
   * - respect `yearDomainMode === "manual"`
   *
   * For auto-domain updates, prefer a single `patch()` call that
   * updates domain + draft fields together (see App.jsx).
   */
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
