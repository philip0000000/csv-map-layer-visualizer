import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import GeoMap from "./components/GeoMap";
import CsvPanel from "./components/CsvPanel";
import { useCsvFiles } from "./components/useCsvFiles";
import { derivePointsFromCsv } from "./components/derivePoints";
import { useTimelineFilterState } from "./components/useTimelineFilterState";
import { autoDetectTimelineFields, tryGetYear } from "./components/timeline";

/**
 * Limits for the CSV panel width.
 * These prevent the panel from becoming too small or too large.
 */
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 720;

/**
 * When the panel is collapsed, this many pixels stay visible.
 * This is the width of the ">" handle, like in Google Maps.
 */
const HANDLE_VISIBLE_PX = 34;

export default function App() {
  /**
   * CSV file state and actions.
   * - files: all loaded CSV files
   * - selectedId: currently selected CSV file ID
   * - selected: the selected CSV file object (or null)
   * - importFiles: load new CSV files
   * - unloadSelected: remove the selected CSV file
   * - updateFileMapping: update lat/lon mapping for a file
   */
  const {
    files,
    selectedId,
    selected,
    setSelectedId,
    importFiles,
    unloadSelected,
    updateFileMapping,
  } = useCsvFiles();

  const timelineApi = useTimelineFilterState();

  const timelineFields = useMemo(() => {
    if (!selected?.headers) {
      return { yearField: null, dateField: null, dayOfYearField: null };
    }
    return autoDetectTimelineFields(selected.headers);
  }, [selected?.headers]);

  // When timeline is enabled, compute year domain from selected file
  useEffect(() => {
  if (!selected) return;
  if (!timelineApi.state.timelineEnabled) return;

  // New: if user has set a manual year domain, do not overwrite it from data
  if (timelineApi.state.yearDomainMode === "manual") return;

  let min = null;
  let max = null;

  for (const r of selected.rows ?? []) {
    const y = tryGetYear(r, timelineFields);
    if (y == null) continue;

    if (min == null || y < min) min = y;
    if (max == null || y > max) max = y;
  }

  timelineApi.setYearDomain(min, max);

  const s = timelineApi.state.startYear;
  const e = timelineApi.state.endYear;

  if (min != null && max != null) {
    const nextStart = s == null ? min : Math.max(min, Math.min(max, s));
    const nextEnd = e == null ? max : Math.max(min, Math.min(max, e));

    const finalStart = Math.min(nextStart, nextEnd);
    const finalEnd = Math.max(nextStart, nextEnd);

    if (finalStart !== s || finalEnd !== e) {
      timelineApi.setYearRange(finalStart, finalEnd);
    }
  }
  }, [
    selected?.id,
    timelineApi.state.timelineEnabled,
    timelineApi.state.yearDomainMode,  // New dependency
    selected?.rows,
    timelineFields,
  ]);

  const derived = useMemo(() => {
    if (!selected) return { points: [], skipped: 0, skippedByTimeline: 0 };

    return derivePointsFromCsv({
      rows: selected.rows,
      latField: selected.latField,
      lonField: selected.lonField,
      timeline: timelineApi.state,
      timelineFields,
    });
  }, [selected, timelineApi.state, timelineFields]);

  /** True when the CSV panel is hidden */
  const [isCollapsed, setIsCollapsed] = useState(false);

  /** Current width of the CSV panel (in pixels) */
  const [panelWidth, setPanelWidth] = useState(420);

  /**
   * Ref used while resizing the panel.
   * We store values here so mouse move events
   * do not cause React re-renders.
   */
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startW: 420,
  });

  /**
   * Global mouse listeners for resizing.
   * These listen on the whole window so resizing
   * still works even if the cursor leaves the divider.
   */
  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current.dragging) return;

      // Distance the mouse moved since drag start
      const dx = e.clientX - dragRef.current.startX;

      // New width, clamped to allowed range
      const next = clamp(
        dragRef.current.startW + dx,
        MIN_PANEL_WIDTH,
        MAX_PANEL_WIDTH
      );

      setPanelWidth(next);
    }

    function onUp() {
      // Stop resizing when mouse button is released
      dragRef.current.dragging = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    // Cleanup listeners when component unmounts
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  /**
   * Starts the resize action.
   * Called when the user presses the mouse on the divider.
   */
  function startDrag(e) {
    // Do not allow resizing while the panel is collapsed
    if (isCollapsed) return;

    dragRef.current.dragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startW = panelWidth;
  }

  /**
   * CSS transform for sliding the panel in and out.
   * When collapsed, most of the panel moves off-screen,
   * but the handle stays visible.
   */
  const overlayTransform = isCollapsed
    ? `translateX(${-(panelWidth - HANDLE_VISIBLE_PX)}px)`
    : "translateX(0px)";

  return (
    <div className="appRoot">
      <div className="rightPane">
        <GeoMap
          points={derived.points}
          latField={selected?.latField ?? null}
          lonField={selected?.lonField ?? null}
        />

        <div
          className="csvOverlay"
          style={{
            width: panelWidth,
            transform: overlayTransform,
          }}
          aria-hidden={false}
        >
          {/* Collapse / expand handle.
              Shows "<" when open and ">" when closed. */}
          <button
            type="button"
            className="csvOverlayHandle"
            onClick={() => setIsCollapsed((v) => !v)}
            aria-label={isCollapsed ? "Expand CSV panel" : "Collapse CSV panel"}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? ">" : "<"}
          </button>

          {/* Actual CSV panel content */}
          <div className="csvOverlayContent">
            <CsvPanel
              files={files}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onImportFiles={importFiles}
              onUnloadSelected={unloadSelected}
              onUpdateMapping={updateFileMapping}
              timelineState={timelineApi.state}
              timelineFields={timelineFields}
              onTimelinePatch={timelineApi.patch}
              timelineStats={{
                skippedByTimeline: derived.skippedByTimeline ?? 0,
              }}
            />
          </div>

          {/* Resize divider on the right edge of the panel */}
          <div
            className="csvOverlayDivider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize CSV panel"
            onMouseDown={startDrag}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Limits a number between a minimum and maximum value.
 * Used to keep the panel width within safe bounds.
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}


