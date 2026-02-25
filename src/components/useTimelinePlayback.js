import { useCallback, useEffect, useRef } from "react";

/**
 * useTimelinePlayback
 * Handles timer start/stop and timeline playback updates.
 */
export function useTimelinePlayback({ timelineState, onTimelinePatch }) {
  const timerRef = useRef(null);
  const stateRef = useRef(timelineState);
  const prevDomainRef = useRef({
    yearMin: timelineState?.yearMin ?? null,
    yearMax: timelineState?.yearMax ?? null,
  });

  useEffect(() => {
    stateRef.current = timelineState;
  }, [timelineState]);

  const stopPlayback = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const current = stateRef.current;
    if (!current?.playback?.isPlaying) return;

    onTimelinePatch?.({
      playback: {
        ...current.playback,
        isPlaying: false,
      },
    });
  }, [onTimelinePatch]);

  const isPlaybackConfigValid = useCallback((state) => {
    const stepYears = Number.parseInt(String(state?.playback?.stepYears ?? ""), 10);
    const intervalMs = Number(state?.playback?.intervalMs);

    return Number.isInteger(stepYears) && stepYears > 0 && Number.isFinite(intervalMs) && intervalMs > 0;
  }, []);

  const runTick = useCallback(() => {
    const current = stateRef.current;

    if (!current?.timelineEnabled) {
      stopPlayback();
      return;
    }

    if (!isPlaybackConfigValid(current)) {
      stopPlayback();
      return;
    }

    const yearMax = current?.yearMax;
    const endYear = current?.endYear;

    if (!Number.isFinite(yearMax) || !Number.isFinite(endYear)) {
      stopPlayback();
      return;
    }

    const stepYears = Number.parseInt(String(current.playback.stepYears), 10);

    let delta = stepYears;
    if (endYear + delta > yearMax) {
      delta = yearMax - endYear;
    }

    // Stop when there is no distance left.
    if (delta <= 0) {
      stopPlayback();
      return;
    }

    const nextEnd = endYear + delta;
    const patch = {
      endYear: nextEnd,
      playback: {
        ...current.playback,
        isPlaying: nextEnd !== yearMax,
      },
    };

    if (current.playback.moveStartWithEnd) {
      const startYear = Number(current?.startYear);
      if (Number.isFinite(startYear)) {
        patch.startYear = startYear + delta;
      }
    }

    onTimelinePatch?.(patch);

    if (nextEnd === yearMax) {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isPlaybackConfigValid, onTimelinePatch, stopPlayback]);

  const startPlayback = useCallback(() => {
    if (timerRef.current != null) return;

    const current = stateRef.current;

    if (!current?.timelineEnabled) return;
    if (!isPlaybackConfigValid(current)) return;

    const yearMax = current?.yearMax;
    const endYear = current?.endYear;

    if (!Number.isFinite(yearMax) || !Number.isFinite(endYear)) return;
    if (endYear >= yearMax) return;

    onTimelinePatch?.({
      playback: {
        ...current.playback,
        isPlaying: true,
      },
    });

    timerRef.current = setInterval(() => {
      runTick();
    }, Number(current.playback.intervalMs));
  }, [isPlaybackConfigValid, onTimelinePatch, runTick]);

  useEffect(() => {
    // Stop when timeline gets disabled.
    if (!timelineState?.timelineEnabled) {
      stopPlayback();
    }
  }, [timelineState?.timelineEnabled, stopPlayback]);

  useEffect(() => {
    const prev = prevDomainRef.current;
    const nextYearMin = timelineState?.yearMin ?? null;
    const nextYearMax = timelineState?.yearMax ?? null;

    const domainChanged = prev.yearMin !== nextYearMin || prev.yearMax !== nextYearMax;

    if (domainChanged) {
      stopPlayback();
    }

    prevDomainRef.current = {
      yearMin: nextYearMin,
      yearMax: nextYearMax,
    };
  }, [timelineState?.yearMin, timelineState?.yearMax, stopPlayback]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return {
    isPlaying: !!timelineState?.playback?.isPlaying,
    startPlayback,
    stopPlayback,
  };
}
