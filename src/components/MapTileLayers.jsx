import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { LayerGroup, LayersControl, TileLayer, useMap } from "react-leaflet";
import {
  createCustomTileLayer,
  escapeLeafletText,
  normalizePersistedCustomTileLayers,
  validateCustomTileLayerInput,
} from "./customTileLayers";
import {
  disableCustomTileWarningPeriod,
  dismissCustomTileWarning,
  enableCustomTileWarningPeriod,
  reportCustomTileError,
} from "./customTileLayerWarnings";

const BUILT_IN_TILESETS = {
  osm: {
    name: "Normal (OSM)",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
  satellite: {
    name: "Satellite (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 20,
  },
  labelsBoundaries: {
    name: "Labels + boundaries",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 20,
  },
};

const BLANK_BASE_LAYER_NAME = "Blank background";
const BUILT_IN_BACKGROUND_IDS = Object.freeze({
  blank: "builtin:blank",
  osm: "builtin:osm",
  satellite: "builtin:satellite",
});
const DEFAULT_FORM = Object.freeze({
  name: "",
  url: "",
  attribution: "",
  maxZoom: "",
  type: "background",
});

/** Own built-in and custom raster layer registration without changing CSV map layers. */
export default function MapTileLayers() {
  const { BaseLayer, Overlay } = LayersControl;
  const addButtonRef = useRef(null);
  const desktopBridge = getDesktopCustomTileBridge();
  const [customLayers, setCustomLayers] = useState([]);
  const [activeBackgroundId, setActiveBackgroundId] = useState(BUILT_IN_BACKGROUND_IDS.osm);
  const [enabledOverlayIds, setEnabledOverlayIds] = useState([]);
  const [tileWarnings, setTileWarnings] = useState({});
  const [persistenceWarning, setPersistenceWarning] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [layersReady, setLayersReady] = useState(!desktopBridge);

  useEffect(() => {
    const bridge = desktopBridge;
    if (!bridge) return undefined;

    let active = true;
    bridge.loadCustomTileLayers().then((result) => {
      if (!active) return;
      if (result?.ok) {
        // Revalidate across the IPC boundary before registering any saved URL.
        setCustomLayers(normalizePersistedCustomTileLayers(result.layers));
      } else {
        setPersistenceWarning(
          "Saved custom tile layers could not be loaded. Custom tile-layer changes may not survive an application restart. Built-in map layers remain available.",
        );
      }
      setLayersReady(true);
    }).catch(() => {
      if (active) {
        setPersistenceWarning(
          "Saved custom tile layers could not be loaded. Custom tile-layer changes may not survive an application restart. Built-in map layers remain available.",
        );
        setLayersReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [desktopBridge]);

  /** Add and activate a valid layer locally before attempting desktop persistence. */
  function addCustomLayer(input) {
    const nextOrder = customLayers.reduce(
      (maximum, layer) => Math.max(maximum, layer.creationOrder),
      -1,
    ) + 1;
    const result = createCustomTileLayer(input, {
      existingNames: customLayers.map((layer) => layer.name),
      creationOrder: nextOrder,
    });
    if (!result.ok) return result;

    const layer = result.value;
    setCustomLayers((current) => [...current, layer]);
    if (layer.type === "background") {
      setActiveBackgroundId(layer.id);
    } else {
      setEnabledOverlayIds((current) => [...current, layer.id]);
    }

    const bridge = getDesktopCustomTileBridge();
    if (bridge) {
      bridge.addCustomTileLayer(layer).then((saved) => {
        if (!saved?.ok) showSaveWarning();
      }).catch(showSaveWarning);
    }
    return result;
  }

  /** Remove a custom layer locally, including its active layer and warning state. */
  function removeCustomLayer(layer) {
    if (layer.type === "background" && activeBackgroundId === layer.id) {
      setActiveBackgroundId(BUILT_IN_BACKGROUND_IDS.osm);
    }
    setEnabledOverlayIds((current) => current.filter((id) => id !== layer.id));
    setTileWarnings((current) => disableCustomTileWarningPeriod(current, layer.id));
    setCustomLayers((current) => current.filter((entry) => entry.id !== layer.id));

    const bridge = getDesktopCustomTileBridge();
    if (bridge) {
      bridge.removeCustomTileLayer(layer.id).then((removed) => {
        if (!removed?.ok) showSaveWarning();
      }).catch(showSaveWarning);
    }
  }

  /** Explain a persistence failure without including a layer name or complete URL. */
  function showSaveWarning() {
    setPersistenceWarning(
      "A custom tile-layer change could not be saved and may not survive an application restart.",
    );
  }

  /** Return focus to the map action after either submitting or cancelling the dialog. */
  function closeDialog() {
    setDialogOpen(false);
    globalThis.setTimeout(() => addButtonRef.current?.focus(), 0);
  }

  /** Keep warning state tied to one concrete enabled period of a custom layer. */
  function customLayerEvents(layer) {
    return {
      add: () => {
        setTileWarnings((current) => enableCustomTileWarningPeriod(current, layer.id));
        if (layer.type === "background") {
          setActiveBackgroundId(layer.id);
        } else {
          setEnabledOverlayIds((current) => (
            current.includes(layer.id) ? current : [...current, layer.id]
          ));
        }
      },
      remove: () => {
        setTileWarnings((current) => disableCustomTileWarningPeriod(current, layer.id));
        if (layer.type === "overlay") {
          setEnabledOverlayIds((current) => current.filter((id) => id !== layer.id));
        }
      },
      tileerror: () => {
        // A removed or disabled layer has no active warning period, so late errors are ignored.
        setTileWarnings((current) => reportCustomTileError(current, layer.id));
      },
    };
  }

  const customBackgrounds = customLayers.filter((layer) => layer.type === "background");
  const customOverlays = customLayers.filter((layer) => layer.type === "overlay");

  return (
    <>
      <LayersControl position="topright" collapsed>
        <BaseLayer
          checked={activeBackgroundId === BUILT_IN_BACKGROUND_IDS.blank}
          name={BLANK_BASE_LAYER_NAME}
        >
          <LayerGroup
            eventHandlers={{
              add: () => setActiveBackgroundId(BUILT_IN_BACKGROUND_IDS.blank),
            }}
          />
        </BaseLayer>

        <BaseLayer
          checked={activeBackgroundId === BUILT_IN_BACKGROUND_IDS.osm}
          name={BUILT_IN_TILESETS.osm.name}
        >
          <TileLayer
            attribution={BUILT_IN_TILESETS.osm.attribution}
            url={BUILT_IN_TILESETS.osm.url}
            maxZoom={BUILT_IN_TILESETS.osm.maxZoom}
            eventHandlers={{
              add: () => setActiveBackgroundId(BUILT_IN_BACKGROUND_IDS.osm),
            }}
          />
        </BaseLayer>

        <BaseLayer
          checked={activeBackgroundId === BUILT_IN_BACKGROUND_IDS.satellite}
          name={BUILT_IN_TILESETS.satellite.name}
        >
          <TileLayer
            attribution={BUILT_IN_TILESETS.satellite.attribution}
            url={BUILT_IN_TILESETS.satellite.url}
            maxZoom={BUILT_IN_TILESETS.satellite.maxZoom}
            eventHandlers={{
              add: () => setActiveBackgroundId(BUILT_IN_BACKGROUND_IDS.satellite),
            }}
          />
        </BaseLayer>

        {customBackgrounds.map((layer) => (
          <BaseLayer
            key={layer.id}
            checked={activeBackgroundId === layer.id}
            name={escapeLeafletText(layer.name)}
          >
            <TileLayer
              attribution={escapeLeafletText(layer.attribution)}
              url={layer.url}
              {...(layer.maxZoom === null ? {} : { maxZoom: layer.maxZoom })}
              eventHandlers={customLayerEvents(layer)}
            />
          </BaseLayer>
        ))}

        <Overlay name={BUILT_IN_TILESETS.labelsBoundaries.name} checked={false}>
          <TileLayer
            attribution={BUILT_IN_TILESETS.labelsBoundaries.attribution}
            url={BUILT_IN_TILESETS.labelsBoundaries.url}
            maxZoom={BUILT_IN_TILESETS.labelsBoundaries.maxZoom}
            opacity={1}
          />
        </Overlay>

        {customOverlays.map((layer) => (
          <Overlay
            key={layer.id}
            checked={enabledOverlayIds.includes(layer.id)}
            name={escapeLeafletText(layer.name)}
          >
            <TileLayer
              attribution={escapeLeafletText(layer.attribution)}
              url={layer.url}
              {...(layer.maxZoom === null ? {} : { maxZoom: layer.maxZoom })}
              eventHandlers={customLayerEvents(layer)}
            />
          </Overlay>
        ))}
      </LayersControl>

      <AddCustomTileLayerControl
        buttonRef={addButtonRef}
        disabled={!layersReady}
        onOpen={() => setDialogOpen(true)}
      />

      <MapTileMessages
        customLayers={customLayers}
        persistenceWarning={persistenceWarning}
        tileWarnings={tileWarnings}
        onDismissPersistence={() => setPersistenceWarning(null)}
        onDismissTile={(layerId) => setTileWarnings((current) => (
          dismissCustomTileWarning(current, layerId)
        ))}
      />

      {dialogOpen && (
        <CustomTileLayerDialog
          customLayers={customLayers}
          onAdd={addCustomLayer}
          onClose={closeDialog}
          onRemove={removeCustomLayer}
        />
      )}
    </>
  );
}

/** Place the custom-layer action first inside Leaflet's generated layer picker. */
function AddCustomTileLayerControl({ buttonRef, disabled, onOpen }) {
  const map = useMap();
  const container = useMemo(() => {
    const element = L.DomUtil.create("div", "leaflet-bar mapTileLayerAddControl");
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  }, []);

  useEffect(() => {
    const picker = map.getContainer().querySelector(".leaflet-control-layers-list");
    if (!picker) return undefined;

    // Prepending keeps the action above both background and overlay choices.
    picker.prepend(container);
    return () => container.remove();
  }, [container, map]);

  return createPortal(
    <button ref={buttonRef} type="button" disabled={disabled} onClick={onOpen}>
      {disabled ? "Loading custom tile layers…" : "Add custom tile layer…"}
    </button>,
    container,
  );
}

/** Collect accessible input, inline validation, guidance, and custom-layer removal. */
function CustomTileLayerDialog({ customLayers, onAdd, onClose, onRemove }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  /** Update one form value and clear only the error the user is correcting. */
  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: null }));
  }

  /** Keep invalid input visible and close only after a normalized layer is added. */
  function submit(event) {
    event.preventDefault();
    const initialValidation = validateCustomTileLayerInput(form, {
      existingNames: customLayers.map((layer) => layer.name),
    });
    if (!initialValidation.ok) {
      setErrors(initialValidation.errors);
      return;
    }

    const result = onAdd(initialValidation.value);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onClose();
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="customTileLayerDialog"
      aria-labelledby="customTileLayerDialogTitle"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="customTileLayerDialogTitle">Add custom tile layer</h2>
      <form onSubmit={submit} noValidate>
        <CustomTileTextField
          id="customTileLayerName"
          label="Layer name"
          value={form.name}
          error={errors.name}
          autoFocus
          onChange={(value) => updateField("name", value)}
        />
        <CustomTileTextField
          id="customTileLayerUrl"
          label="Tile URL"
          value={form.url}
          error={errors.url}
          placeholder="https://tiles.example.com/{z}/{x}/{y}"
          onChange={(value) => updateField("url", value)}
        />
        <CustomTileTextField
          id="customTileLayerAttribution"
          label="Attribution"
          value={form.attribution}
          error={errors.attribution}
          onChange={(value) => updateField("attribution", value)}
        />
        <p className="customTileLayerFieldHelp">
          Omit attribution only when the tile source does not require it. Attribution is displayed
          as plain text.
        </p>
        <CustomTileTextField
          id="customTileLayerMaxZoom"
          label="Maximum zoom (optional)"
          value={form.maxZoom}
          error={errors.maxZoom}
          inputMode="numeric"
          onChange={(value) => updateField("maxZoom", value)}
        />

        <fieldset>
          <legend>Layer type</legend>
          <label>
            <input
              type="radio"
              name="customTileLayerType"
              value="background"
              checked={form.type === "background"}
              onChange={(event) => updateField("type", event.target.value)}
            />
            Background
          </label>
          <label>
            <input
              type="radio"
              name="customTileLayerType"
              value="overlay"
              checked={form.type === "overlay"}
              onChange={(event) => updateField("type", event.target.value)}
            />
            Overlay
          </label>
        </fieldset>
        {errors.type && <div className="customTileLayerFieldError">{errors.type}</div>}

        <p className="customTileLayerPrivacyNotice">
          Loading this layer sends requests to its provider. Tile URLs may be visible to the app,
          browser or webview, provider, logs, and developer tools; desktop URLs are stored locally.
          Do not include confidential or unrestricted credentials. You are responsible for
          permission and for the provider’s attribution, authentication, rate limits, caching,
          licensing, and usage terms. This application does not verify those requirements.
        </p>

        <div className="customTileLayerDialogActions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="customTileLayerAddButton">Add layer</button>
        </div>
      </form>

      {customLayers.length > 0 && (
        <section className="customTileLayerExisting" aria-labelledby="customTileLayerExistingTitle">
          <h3 id="customTileLayerExistingTitle">Custom layers</h3>
          <ul>
            {customLayers.map((layer) => (
              <li key={layer.id}>
                <span>{layer.name}</span>
                <button
                  type="button"
                  aria-label={`Remove custom tile layer ${layer.name}`}
                  onClick={() => onRemove(layer)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>,
    document.body,
  );
}

/** Render one labelled text field and connect its inline error for assistive technology. */
function CustomTileTextField({
  id,
  label,
  value,
  error,
  onChange,
  autoFocus = false,
  inputMode,
  placeholder,
}) {
  const errorId = `${id}Error`;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <div id={errorId} className="customTileLayerFieldError">{error}</div>}
    </>
  );
}

/** Render persistence and deduplicated tile errors over the map, outside Map tools. */
function MapTileMessages({
  customLayers,
  persistenceWarning,
  tileWarnings,
  onDismissPersistence,
  onDismissTile,
}) {
  const map = useMap();
  const visibleTileWarnings = customLayers.filter((layer) => tileWarnings[layer.id]?.visible);
  if (!persistenceWarning && visibleTileWarnings.length === 0) return null;

  return createPortal(
    <div
      className="mapTileLayerMessages"
      aria-live="polite"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {persistenceWarning && (
        <MapTileMessage message={persistenceWarning} onDismiss={onDismissPersistence} />
      )}
      {visibleTileWarnings.map((layer) => (
        <MapTileMessage
          key={layer.id}
          message={`Some tiles for “${layer.name}” could not be loaded. Check the URL, server, CORS settings, and available zoom levels.`}
          onDismiss={() => onDismissTile(layer.id)}
        />
      ))}
    </div>,
    map.getContainer(),
  );
}

/** Provide a consistent dismiss button for map-adjacent custom-layer warnings. */
function MapTileMessage({ message, onDismiss }) {
  return (
    <div className="mapTileLayerMessage" role="status">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss warning" onClick={onDismiss}>×</button>
    </div>
  );
}

/** Detect only the fixed preload surface; browser builds remain memory-only. */
function getDesktopCustomTileBridge() {
  const bridge = globalThis.csvMapDesktop;
  if (
    bridge?.isDesktop === true &&
    typeof bridge.loadCustomTileLayers === "function" &&
    typeof bridge.addCustomTileLayer === "function" &&
    typeof bridge.removeCustomTileLayer === "function"
  ) {
    return bridge;
  }
  return null;
}
