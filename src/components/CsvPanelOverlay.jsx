import { useEffect, useRef, useState } from "react";

/**
 * Limits for the CSV panel width.
 * These prevent the panel from becoming too small or too large.
 */
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH_RATIO = 0.85;

/**
 * When the panel is collapsed, this many pixels stay visible.
 * This is the width of the ">" handle, like in Google Maps.
 */
const HANDLE_VISIBLE_PX = 34;

export function CsvPanelOverlay({ children }) {
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
        getMaxPanelWidth(),
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
    <div
      className="csvOverlay"
      style={{
        width: panelWidth,
        transform: overlayTransform,
      }}
      aria-hidden={false}
    >
      <button
        type="button"
        className="csvOverlayHandle"
        onClick={() => setIsCollapsed((value) => !value)}
        aria-label={isCollapsed ? "Expand CSV panel" : "Collapse CSV panel"}
        title={isCollapsed ? "Expand" : "Collapse"}
      >
        {isCollapsed ? ">" : "<"}
      </button>

      <div className="csvOverlayContent">{children}</div>

      <div
        className="csvOverlayDivider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize CSV panel"
        onMouseDown={startDrag}
      />
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

function getMaxPanelWidth() {
  return Math.max(
    MIN_PANEL_WIDTH,
    Math.floor(window.innerWidth * MAX_PANEL_WIDTH_RATIO),
  );
}
