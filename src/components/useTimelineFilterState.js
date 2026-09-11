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

/** Persist timeline settings and expose state with a shallow patch function. */
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

  // Nested settings such as playback must be merged by the caller.
  const patch = useCallback((partial) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, [setState]);

  return {
    state,
    patch,
  };
}
