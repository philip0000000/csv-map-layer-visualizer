import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import GeoMap from "./components/GeoMap";
import CsvPanel from "./components/CsvPanel";
import { useCsvFiles } from "./components/useCsvFiles";

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
   * - selectedId: currently selected CSV file
   * - importFiles: load new CSV files
   * - unloadSelected: remove the selected CSV file
   */
  const { files, selectedId, setSelectedId, importFiles, unloadSelected } =
    useCsvFiles();

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
    dragging: false, // true while the mouse is dragging
    startX: 0,       // mouse X position when drag started
    startW: 420,     // panel width when drag started
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
        {/* Full-screen map.
            The map is always visible and unaffected by the CSV panel. */}
        <GeoMap />

        {/* CSV panel overlay.
            This sits on top of the map and slides in/out. */}
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


