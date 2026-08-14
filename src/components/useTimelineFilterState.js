import { useCallback, useEffect } from "react";
import { useSessionStorageState } from "./useSessionStorageState";

const STORAGE_KEY = "csv-map-layer-visualizer.timeline.v1";

const DEFAULT_STATE = {
  timelineEnabled: false,

  // Retained for saved-state compatibility; ranges now change only explicitly.
  yearDomainMode: "manual",
  yearMinDraft: "-2100",
  yearMaxDraft: "2026",

  // Keep the configured range ready without filtering the initial map view.
  yearMin: -2100,
  yearMax: 2026,

  // Selected range
  startYear: -2100,
  endYear: 2026,

  // Optional day filter
  dayFilterEnabled: false,
  startDay: 1,
  endDay: 365,

  // UI-only expanders (panel open/close state)
  moreFiltersOpen: false,
  playbackOpen: false,

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

  const patch = useCallback((partial) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, [setState]);

  /*
   * Sets the year domain without changing drafts or the selected range.
   *
   * This legacy helper remains available to callers that intentionally want
   * that narrow update; imports and dataset changes never call it.
   */
  const setYearDomain = useCallback((yearMin, yearMax) => {
    setState((prev) => ({
      ...prev,
      yearMin: yearMin ?? null,
      yearMax: yearMax ?? null,
    }));
  }, [setState]);

  const setYearRange = useCallback((startYear, endYear) => {
    setState((prev) => ({
      ...prev,
      startYear: startYear ?? null,
      endYear: endYear ?? null,
    }));
  }, [setState]);

  const setDayRange = useCallback((startDay, endDay) => {
    setState((prev) => ({
      ...prev,
      startDay: clampInt(startDay, 1, 365),
      endDay: clampInt(endDay, 1, 365),
    }));
  }, [setState]);

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
