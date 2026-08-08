import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import {
  formatCoordinatePair,
  parseCoordinatePaste,
  validateCoordinateInputs,
} from "./coordinateNavigation";

const CONTEXT_MENU_WIDTH = 240;
const CONTEXT_MENU_HEIGHT = 84;

/** Keep the pointer-anchored map menu inside the visible viewport. */
function getContextMenuPosition(clientX, clientY) {
  const viewportWidth = globalThis.innerWidth ?? CONTEXT_MENU_WIDTH;
  const viewportHeight = globalThis.innerHeight ?? CONTEXT_MENU_HEIGHT;
  return {
    left: Math.max(8, Math.min(clientX + 8, viewportWidth - CONTEXT_MENU_WIDTH - 8)),
    top: Math.max(8, Math.min(clientY + 8, viewportHeight - CONTEXT_MENU_HEIGHT - 8)),
  };
}

/** Add coordinate copying and fixed-zoom navigation to the active Leaflet map. */
export default function MapCoordinateControls() {
  const map = useMap();
  const contextMenuRef = useRef(null);
  const latitudeInputRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [errors, setErrors] = useState({ latitude: null, longitude: null });

  useEffect(() => {
    const mapContainer = map.getContainer();

    /** Replace the browser menu and retain both the geographic and screen positions. */
    function handleContextMenu(event) {
      event.preventDefault();
      const latLng = map.mouseEventToLatLng(event);
      setContextMenu({
        text: formatCoordinatePair(latLng.lat, latLng.lng),
        ...getContextMenuPosition(event.clientX, event.clientY),
      });
    }

    // Capture before Leaflet layers can stop bubbling from marker or overlay DOM.
    mapContainer.addEventListener("contextmenu", handleContextMenu, true);
    return () => mapContainer.removeEventListener("contextmenu", handleContextMenu, true);
  }, [map]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    /** Close the map menu unless the pointer action occurred inside it. */
    function handleOutsidePointerDown(event) {
      if (!contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    }

    /** Close the open map menu with the standard Escape interaction. */
    function handleMenuKeyDown(event) {
      if (event.key === "Escape") setContextMenu(null);
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleMenuKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!dialogOpen) return undefined;

    latitudeInputRef.current?.focus();

    /** Close the coordinate dialog without moving the map when Escape is pressed. */
    function handleDialogKeyDown(event) {
      if (event.key === "Escape") closeDialog();
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [dialogOpen]);

  /** Copy exactly the six-decimal coordinate string shown in the menu. */
  async function copyCoordinates() {
    const text = contextMenu?.text;
    setContextMenu(null);
    try {
      if (!globalThis.navigator?.clipboard?.writeText) {
        throw new Error("Clipboard writing is unavailable.");
      }
      await globalThis.navigator.clipboard.writeText(text);
      // Successful copying deliberately has no toast or other user notification.
    } catch (error) {
      console.error("Could not copy map coordinates.", error);
    }
  }

  /** Open a fresh coordinate dialog and discard values from any earlier visit. */
  function openDialog() {
    setContextMenu(null);
    setLatitude("");
    setLongitude("");
    setErrors({ latitude: null, longitude: null });
    setDialogOpen(true);
  }

  /** Close and reset the coordinate dialog without changing the map. */
  function closeDialog() {
    setDialogOpen(false);
    setLatitude("");
    setLongitude("");
    setErrors({ latitude: null, longitude: null });
  }

  /** Split only complete supported coordinate pairs pasted into Latitude. */
  function handleLatitudePaste(event) {
    const pair = parseCoordinatePaste(event.clipboardData.getData("text"));
    if (!pair) return;

    // Prevent the ordinary paste only after the complete pair is recognized.
    event.preventDefault();
    setLatitude(pair.latitude);
    setLongitude(pair.longitude);
    setErrors({ latitude: null, longitude: null });
  }

  /** Validate both fields and centre the map while retaining its current zoom. */
  function handleSubmit(event) {
    event.preventDefault();
    const result = validateCoordinateInputs(latitude, longitude);
    setErrors(result.errors);
    if (!result.ok) return;

    map.setView([result.latitude, result.longitude], map.getZoom());
    closeDialog();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="mapCoordinateContextMenu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          role="menu"
          aria-label="Map coordinate actions"
        >
          <button type="button" role="menuitem" onClick={copyCoordinates}>
            {contextMenu.text}
          </button>
          <button type="button" role="menuitem" onClick={openDialog}>
            Go to coordinates…
          </button>
        </div>
      )}

      {dialogOpen && (
        <div className="mapCoordinateDialogBackdrop">
          <div
            className="mapCoordinateDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mapCoordinateDialogTitle"
          >
            <h2 id="mapCoordinateDialogTitle">Go to coordinates</h2>
            <form onSubmit={handleSubmit} noValidate>
              <label htmlFor="mapCoordinateLatitude">Latitude</label>
              <input
                ref={latitudeInputRef}
                id="mapCoordinateLatitude"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={latitude}
                aria-invalid={!!errors.latitude}
                aria-describedby={errors.latitude ? "mapCoordinateLatitudeError" : undefined}
                onChange={(event) => {
                  setLatitude(event.target.value);
                  setErrors((current) => ({ ...current, latitude: null }));
                }}
                onPaste={handleLatitudePaste}
              />
              {errors.latitude && (
                <div id="mapCoordinateLatitudeError" className="mapCoordinateFieldError">
                  {errors.latitude}
                </div>
              )}

              <label htmlFor="mapCoordinateLongitude">Longitude</label>
              <input
                id="mapCoordinateLongitude"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={longitude}
                aria-invalid={!!errors.longitude}
                aria-describedby={errors.longitude ? "mapCoordinateLongitudeError" : undefined}
                onChange={(event) => {
                  setLongitude(event.target.value);
                  setErrors((current) => ({ ...current, longitude: null }));
                }}
              />
              {errors.longitude && (
                <div id="mapCoordinateLongitudeError" className="mapCoordinateFieldError">
                  {errors.longitude}
                </div>
              )}

              <div className="mapCoordinateDialogActions">
                <button type="button" onClick={closeDialog}>Cancel</button>
                <button type="submit" className="mapCoordinateGoButton">Go</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
