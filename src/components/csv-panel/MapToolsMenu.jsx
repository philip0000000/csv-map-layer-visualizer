import { useCallback, useEffect, useRef } from "react";
import { useSessionStorageState } from "../useSessionStorageState";

// Persisted UI tool state for the CSV panel.
// - open: whether the dropdown is expanded
// - toggles: boolean feature flags (UI only for now; no feature logic yet)
const TOOLS_KEY = "csv-map-layer-visualizer.tools.v1";

// We only keep "showTimelineFilter" for now (as a placeholder toggle)
const DEFAULT_TOOLS_STATE = {
  map: {
    open: false,
    toggles: {
      showTimelineFilter: false,
    },
  },
};

export default function MapToolsMenu({
  timelineState,
  onTimelinePatch,
  mapToolsState,
  onMapToolsPatch,
}) {
  const [tools, setTools] = useSessionStorageState(
    TOOLS_KEY,
    DEFAULT_TOOLS_STATE,
  );

  /**
   * Ref for the tool menus container.
   * Used to detect clicks outside the menus (to auto-close dropdowns).
   */
  const toolMenusRef = useRef(null);

  function setMapToolsOpen(isOpen) {
    setTools((prev) => ({
      ...prev,
      map: {
        ...(prev?.map ?? { open: false, toggles: {} }),
        open: isOpen,
      },
    }));
  }

  /**
   * Close all tool dropdowns.
   * Kept as a helper so outside-click and Esc can share the same logic.
   */
  const closeAllToolMenus = useCallback(() => {
    setTools((prev) => ({
      ...prev,
      map: { ...(prev?.map ?? { open: false, toggles: {} }), open: false },
    }));
  }, [setTools]);

  /**
   * Auto-close open tool menus when:
   * - user clicks anywhere outside the tool menus (including the map)
   * - user presses Escape
   *
   * Using pointerdown + capture phase makes this robust with Leaflet,
   * which sometimes stops propagation on map interactions.
   */
  useEffect(() => {
    const anyOpen = !!tools?.map?.open;
    if (!anyOpen) return;

    function onPointerDownCapture(e) {
      const root = toolMenusRef.current;
      if (!root) return;

      // If the click is inside the tool menus area, do nothing.
      if (root.contains(e.target)) return;

      // Otherwise, close any open dropdowns.
      closeAllToolMenus();
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      closeAllToolMenus();
    }

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeAllToolMenus, tools?.map?.open]); // only rebind when open state changes

  return (
    <div className="csvToolMenus" aria-label="Tool menus" ref={toolMenusRef}>
      {/* Map tools */}
      <section className="csvToolMenu">
        <button
          type="button"
          className="csvToolMenuHeader"
          aria-expanded={!!tools?.map?.open}
          onClick={() => setMapToolsOpen(!tools?.map?.open)}
        >
          <span className="csvToolMenuTitle">Map tools</span>
          <span className="csvToolMenuChevron" aria-hidden="true">
            {tools?.map?.open ? "▾" : "▸"}
          </span>
        </button>

        {/* Dropdown overlays */}
        {tools?.map?.open && (
          <div
            className="csvToolMenuBody"
            role="menu"
            aria-label="Map tools menu"
          >
            {/* Toggle timeline filter on/off */}
            <label
              className="csvToolToggle"
              role="menuitemcheckbox"
              aria-checked={!!timelineState?.timelineEnabled}
            >
              <input
                type="checkbox"
                checked={!!timelineState?.timelineEnabled}
                onChange={(e) =>
                  onTimelinePatch?.({ timelineEnabled: e.target.checked })
                }
              />
              <span>Timeline</span>
            </label>

            {/* Toggle marker clustering on/off */}
            <label
              className="csvToolToggle"
              role="menuitemcheckbox"
              aria-checked={!!mapToolsState?.clusterMarkersEnabled}
            >
              <input
                type="checkbox"
                checked={!!mapToolsState?.clusterMarkersEnabled}
                onChange={(e) =>
                  onMapToolsPatch?.({ clusterMarkersEnabled: e.target.checked })
                }
              />
              <span>Cluster markers</span>
            </label>

            {/* 
                Cluster radius settings:
                - Only shown when clustering is enabled
                - User can type a number
                - The value is applied only when the input loses focus (onBlur)
                - This avoids recalculating clusters while typing
              */}
            {mapToolsState?.clusterMarkersEnabled && (
              <div style={{ marginTop: 8 }}>
                <div className="csvLabel">Cluster radius (pixels)</div>

                <input
                  className="csvSelect"
                  type="number"
                  min={1}
                  max={300}
                  step={1}
                  // Draft value: can be edited freely without changing the map yet
                  value={mapToolsState?.clusterRadiusDraft ?? ""}
                  onChange={(e) =>
                    onMapToolsPatch?.({ clusterRadiusDraft: e.target.value })
                  }
                  onBlur={() => {
                    // When leaving the input:
                    // - Parse the number
                    // - Fix invalid values
                    // - Clamp to a safe range
                    // - Commit it as the real cluster radius
                    const raw = mapToolsState?.clusterRadiusDraft;

                    let n = Number.parseInt(String(raw ?? "").trim(), 10);
                    if (!Number.isFinite(n)) {
                      n = mapToolsState?.clusterRadius ?? 80;
                    }

                    // Clamp to a safe range
                    n = Math.max(1, Math.min(300, n));

                    // Commit value only on blur (leave box)
                    onMapToolsPatch?.({
                      clusterRadius: n,
                      clusterRadiusDraft: n,
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
