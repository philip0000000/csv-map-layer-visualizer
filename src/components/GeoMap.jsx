import { useCallback, useEffect, useRef, useState } from "react";
// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// Marker and Popup are used to show points on the map.
import {
  MapContainer,
  Marker,
  ImageOverlay,
  CircleMarker,
  Polygon,
  Polyline,
  Popup,
  ZoomControl,
  useMap,
} from "react-leaflet";

// MarkerClusterGroup is a React wrapper around Leaflet's marker clustering plugin.
// It groups nearby markers into clusters for readability and performance.
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet-polylinedecorator";

import { getClusterMarkerIcon, getMarkerIcon } from "./markerIcons";
import { buildMarkerDetailFields } from "./markerDetailFields";
import MapCoordinateControls from "./MapCoordinateControls";
import MapTileLayers from "./MapTileLayers";
import {
  findMarkersNearClickedMarker,
  MARKER_PROXIMITY_RADIUS_PIXELS,
} from "./markerProximitySelection";
import {
  calculateZoneTransformCenter,
  getZoneDragOperation,
  isEditableInteractionTarget,
  shouldApplyZoneCommit,
  transformZoneParts,
} from "./zoneTransform";

function getFeaturePopupRow(feature, getSourceRow) {
  return feature?.row ?? getSourceRow?.(feature?.sourceFileId, feature?.sourceRowIndex) ?? null;
}

function isGroupedPointFeature(point) {
  return point?.renderType === "grouped" || point?.renderType === "representative";
}

/**
 * Attach the CSV marker value to the Leaflet marker instance.
 * MarkerClusterGroup only sees Leaflet markers, so the cluster icon code reads this later.
 */
function setCsvMarkerValue(marker, markerValue) {
  if (marker) {
    marker.options.csvMarkerValue = markerValue;
  }
}

/**
 * Build a custom cluster icon from the first marker in the cluster.
 * This preserves the first row marker style and adds the cluster count badge.
 */
function createMarkerClusterIcon(cluster) {
  const childMarkers = typeof cluster?.getAllChildMarkers === "function"
    ? cluster.getAllChildMarkers()
    : [];
  const firstMarkerValue = childMarkers[0]?.options?.csvMarkerValue;
  const count = typeof cluster?.getChildCount === "function"
    ? cluster.getChildCount()
    : childMarkers.length;

  return getClusterMarkerIcon(firstMarkerValue, count);
}

/**
 * Hide the original cluster icon while spiderfied markers are spread out.
 * The spread markers remain visible; the center marker would just add visual noise.
 */
function setClusterIconVisibility(cluster, isVisible) {
  const iconElement =
    typeof cluster?.getElement === "function"
      ? cluster.getElement()
      : cluster?._icon;

  if (iconElement) {
    iconElement.style.visibility = isVisible ? "" : "hidden";
  }
}

function FeaturePopup({ feature, fallbackTitle, getSourceRow, getFeatureDetails }) {
  const requestRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [detailState, setDetailState] = useState({
    status: "idle",
    details: null,
  });
  const loadsFromBackend =
    typeof getFeatureDetails === "function" && !!feature?.sourceRef;
  const row = loadsFromBackend
    ? detailState.details?.row ?? null
    : getFeaturePopupRow(feature, getSourceRow);
  const latField = detailState.details?.latField ?? feature.latField;
  const lonField = detailState.details?.lonField ?? feature.lonField;

  // Opening a popup is the detail boundary. Compact viewport responses never
  // cause eager source-row reads for every rendered line or region.
  useEffect(() => {
    if (!isOpen || !loadsFromBackend) {
      requestRef.current += 1;
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    queueMicrotask(() => {
      if (requestRef.current !== requestId) return;
      setDetailState({ status: "loading", details: null });
      Promise.resolve(getFeatureDetails({
        featureId: feature.id,
        sourceRef: feature.sourceRef,
      })).then((details) => {
        if (requestRef.current !== requestId) return;
        setDetailState({
          status: details?.row ? "loaded" : "empty",
          details: details?.row ? details : null,
        });
      }).catch(() => {
        if (requestRef.current === requestId) {
          setDetailState({ status: "error", details: null });
        }
      });
    });
    return () => {
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [feature.id, feature.sourceRef, getFeatureDetails, isOpen, loadsFromBackend]);

  const title = String(row?.name ?? feature?.featureId ?? fallbackTitle);
  return (
    <Popup
      eventHandlers={{
        add: () => setIsOpen(true),
        remove: () => setIsOpen(false),
      }}
    >
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
        {loadsFromBackend && detailState.status === "loading" && (
          <div>Loading details...</div>
        )}
        {loadsFromBackend && detailState.status === "empty" && (
          <div>No details found.</div>
        )}
        {loadsFromBackend && detailState.status === "error" && (
          <div>Could not load details.</div>
        )}
        {(!loadsFromBackend || detailState.status === "loaded") &&
          buildMarkerDetailFields(row, latField, lonField).map(([key, value]) => (
            <div key={key} style={{ marginBottom: 4 }}>
              <b>{key}:</b> {String(value ?? "")}
            </div>
          ))}
      </div>
    </Popup>
  );
}

function LineArrowDecorator({ line }) {
  const map = useMap();

  useEffect(() => {
    const mode = String(line?.arrow ?? "none").toLowerCase();
    if (mode === "none") return undefined;

    const coords = Array.isArray(line?.coordinates) ? line.coordinates : [];
    if (coords.length < 2) return undefined;

    if (typeof L.polylineDecorator !== "function" || !L.Symbol?.arrowHead) {
      return undefined;
    }

    const color = line?.style?.color ?? "#3388ff";
    const weight = Number.isFinite(line?.style?.weight) ? line.style.weight : 3;
    const pixelSize = Math.max(
      6,
      Math.min(18, Math.round(weight * 2 * 1.4))
    );
    const patterns = [];

    if (mode === "start" || mode === "both") {
      patterns.push({
        offset: "0%",
        repeat: 0,
        symbol: L.Symbol.arrowHead({
          pixelSize,
          polygon: true,
          pathOptions: {
            color,
            weight: 1,
            fillOpacity: 1,
            fillColor: color,
          },
        }),
      });
    }

    if (mode === "end" || mode === "both") {
      patterns.push({
        offset: "100%",
        repeat: 0,
        symbol: L.Symbol.arrowHead({
          pixelSize,
          polygon: true,
          pathOptions: {
            color,
            weight: 1,
            fillOpacity: 1,
            fillColor: color,
          },
        }),
      });
    }

    if (patterns.length === 0) return undefined;

    const decorator = L.polylineDecorator(coords, { patterns });
    decorator.addTo(map);

    return () => {
      map.removeLayer(decorator);
    };
  }, [
    map,
    line?.arrow,
    line?.coordinates,
    line?.style?.color,
    line?.style?.weight,
  ]);

  return null;
}
function ViewportChangeReporter({ onViewportChange }) {
  const map = useMap();

  useEffect(() => {
    if (typeof onViewportChange !== "function") return undefined;

    const reportViewport = () => {
      const bounds = map.getBounds();

      onViewportChange({
        bounds: {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
        zoom: map.getZoom(),
      });
    };

    reportViewport();

    map.on("moveend zoomend", reportViewport);

    return () => {
      map.off("moveend zoomend", reportViewport);
    };
  }, [map, onViewportChange]);

  return null;
}

/** Own logical-zone selection, live preview, and one commit per completed drag. */
function EditableRegions({
  regions,
  enabled,
  enabledDatasetIds,
  getLogicalZone,
  updateLogicalZone,
  onError,
  getSourceRow,
  getFeatureDetails,
}) {
  const map = useMap();
  const [selectedZone, setSelectedZone] = useState(null);
  const [previewParts, setPreviewParts] = useState(null);
  const selectedZoneRef = useRef(null);
  const previewPartsRef = useRef(null);
  const dragRef = useRef(null);
  const enabledRef = useRef(enabled);
  const keyStateRef = useRef({ zHeld: false, xHeld: false });
  const selectionRequestRef = useRef(0);
  const zoneInteractionRef = useRef(0);

  // Keep asynchronous commit checks synchronized with the latest rendered edit-mode prop.
  enabledRef.current = enabled;

  function storeSelectedZone(value) {
    selectedZoneRef.current = value;
    setSelectedZone(value);
  }

  function storePreviewParts(value) {
    previewPartsRef.current = value;
    setPreviewParts(value);
  }

  /** Restore Leaflet and document listeners after every drag exit path. */
  const endDragInteraction = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return null;
    document.removeEventListener("mousemove", drag.handleMove, true);
    document.removeEventListener("mouseup", drag.handleUp, true);
    if (drag.mapDraggingWasEnabled) map.dragging.enable();
    dragRef.current = null;
    return drag;
  }, [map]);

  useEffect(() => {
    /** Track only Z and X, ignoring keystrokes originating in editable controls. */
    function handleKey(event, held) {
      if (held && isEditableInteractionTarget(event.target)) return;
      const key = String(event.key ?? "").toLowerCase();
      if (key === "z") keyStateRef.current.zHeld = held;
      if (key === "x") keyStateRef.current.xHeld = held;
    }
    const handleKeyDown = (event) => handleKey(event, true);
    const handleKeyUp = (event) => handleKey(event, false);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => () => endDragInteraction(), [endDragInteraction]);

  useEffect(() => {
    const datasetAvailable = selectedZone?.datasetId
      && enabledDatasetIds?.includes(selectedZone.datasetId);
    if (enabled && (!selectedZone || datasetAvailable)) return;
    selectionRequestRef.current += 1;
    zoneInteractionRef.current += 1;
    endDragInteraction();
    storePreviewParts(null);
    storeSelectedZone(null);
  }, [enabled, enabledDatasetIds, endDragInteraction, selectedZone]);

  /** Select the full logical feature, scoped by the clicked part's dataset. */
  async function selectRegion(region, event) {
    if (!enabled || typeof getLogicalZone !== "function") return;
    L.DomEvent.stopPropagation(event.originalEvent);
    const datasetId = region.sourceRef?.datasetId;
    const featureId = region.featureId;
    if (!datasetId || !featureId) return;
    if (
      selectedZoneRef.current?.datasetId === datasetId
      && selectedZoneRef.current?.featureId === featureId
    ) return;
    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    try {
      const zone = await getLogicalZone({ datasetId, featureId });
      // Ignore a slower lookup after the user has already requested another zone.
      if (selectionRequestRef.current !== requestId || !enabledRef.current) return;
      // A completed selection invalidates any save response belonging to the old zone.
      zoneInteractionRef.current += 1;
      storePreviewParts(null);
      storeSelectedZone(zone?.parts?.length ? zone : null);
    } catch (error) {
      if (selectionRequestRef.current === requestId) onError?.(error);
    }
  }

  /** Lock one operation at primary-button down and preview only in memory. */
  function beginRegionDrag(region, event) {
    if (!enabled || event.originalEvent?.button !== 0 || dragRef.current) return;
    const zone = selectedZoneRef.current;
    if (
      !zone
      || zone.datasetId !== region.sourceRef?.datasetId
      || zone.featureId !== region.featureId
    ) return;
    const operation = getZoneDragOperation(
      isEditableInteractionTarget(document.activeElement)
        ? {}
        : keyStateRef.current,
    );
    if (!operation) return;
    const center = calculateZoneTransformCenter(zone.parts);
    const startLatLng = map.mouseEventToLatLng(event.originalEvent);
    if (!center || !startLatLng) return;
    const interactionId = zoneInteractionRef.current + 1;
    zoneInteractionRef.current = interactionId;

    L.DomEvent.preventDefault(event.originalEvent);
    L.DomEvent.stopPropagation(event.originalEvent);
    const mapDraggingWasEnabled = map.dragging.enabled();
    if (mapDraggingWasEnabled) map.dragging.disable();

    const handleMove = (mouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const current = map.mouseEventToLatLng(mouseEvent);
      const parts = transformZoneParts(drag.baseParts, {
        operation: drag.operation,
        center: drag.center,
        start: drag.start,
        current,
      });
      storePreviewParts(parts);
    };
    const handleUp = async () => {
      const drag = endDragInteraction();
      const parts = previewPartsRef.current;
      if (!drag || !parts || typeof updateLogicalZone !== "function") {
        storePreviewParts(null);
        return;
      }
      try {
        // SQLite receives one complete multipart payload only after previewing ends,
        // making mouse movement an in-memory operation and mouse-up the commit boundary.
        const committed = await updateLogicalZone({
          datasetId: drag.datasetId,
          featureId: drag.featureId,
          parts: parts.map((part) => ({
            part: part.part,
            coordinates: part.coordinates,
          })),
        });
        if (shouldApplyZoneCommit({
          enabled: enabledRef.current,
          interactionId: drag.interactionId,
          latestInteractionId: zoneInteractionRef.current,
          selectedZone: selectedZoneRef.current,
          datasetId: drag.datasetId,
          featureId: drag.featureId,
        })) {
          storeSelectedZone(committed?.parts?.length ? committed : selectedZoneRef.current);
        }
      } catch (error) {
        onError?.(error);
      } finally {
        // An obsolete response must not clear a newer interaction's live preview.
        if (zoneInteractionRef.current === drag.interactionId) storePreviewParts(null);
      }
    };
    dragRef.current = {
      interactionId,
      datasetId: zone.datasetId,
      featureId: zone.featureId,
      baseParts: zone.parts,
      operation,
      center,
      start: { lat: startLatLng.lat, lng: startLatLng.lng },
      mapDraggingWasEnabled,
      handleMove,
      handleUp,
    };
    document.addEventListener("mousemove", handleMove, true);
    document.addEventListener("mouseup", handleUp, true);
  }

  const selectedKey = selectedZone
    ? `${selectedZone.datasetId}\u0000${selectedZone.featureId}`
    : null;
  const visibleRegions = selectedKey
    ? regions.filter((region) => (
      `${region.sourceRef?.datasetId}\u0000${region.featureId}` !== selectedKey
    ))
    : regions;
  const selectedParts = previewParts ?? selectedZone?.parts ?? [];

  return (
    <>
      {visibleRegions.map((region) => (
        <Polygon
          key={region.id}
          positions={region.coordinates}
          pathOptions={region.style}
          bubblingMouseEvents={!enabled}
          eventHandlers={{
            click: (event) => selectRegion(region, event),
            mousedown: (event) => beginRegionDrag(region, event),
          }}
        >
          {!enabled && (
            <FeaturePopup
              feature={region}
              fallbackTitle="Region"
              getSourceRow={getSourceRow}
              getFeatureDetails={getFeatureDetails}
            />
          )}
        </Polygon>
      ))}
      {selectedZone && selectedParts.map((part) => {
        const region = {
          id: `${selectedZone.datasetId}:${selectedZone.featureId}:${part.part}`,
          featureId: selectedZone.featureId,
          part: part.part,
          coordinates: part.coordinates,
          style: part.style,
          sourceRef: { datasetId: selectedZone.datasetId, rowIndex: 0 },
        };
        return (
          <Polygon
            key={`editing:${region.id}`}
            positions={region.coordinates}
            pathOptions={{ ...region.style, color: "#facc15", weight: 4 }}
            bubblingMouseEvents={false}
            eventHandlers={{
              click: (event) => selectRegion(region, event),
              mousedown: (event) => beginRegionDrag(region, event),
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Render exact point markers and keep proximity selection separate from clustering.
 * The points prop is already scoped by active dataset visibility and timeline filters.
 */
function ExactPointMarkers({
  points,
  clusterMarkersEnabled,
  clusterRadius,
  markerClusterGroupRef,
  onMarkerSelect,
}) {
  const map = useMap();

  /** Project from the clicked marker anchor and forward its ordered nearby matches. */
  function selectWithProximity(clickedMarker) {
    const nearbyMarkers = findMarkersNearClickedMarker(
      points,
      clickedMarker,
      // Container-point projection measures from each marker's map anchor,
      // rather than from the mouse pointer inside the marker icon.
      (marker) => map.latLngToContainerPoint([marker.lat, marker.lon]),
    );
    onMarkerSelect?.(clickedMarker, nearbyMarkers);
  }

  if (clusterMarkersEnabled) {
    return (
      <MarkerClusterGroup
        ref={markerClusterGroupRef}
        // Force a re-init when clustering settings change.
        // Leaflet.markercluster does not always apply maxClusterRadius updates dynamically.
        key={`cluster:${clusterMarkersEnabled ? 1 : 0}:${clusterRadius}`}
        // chunkedLoading improves responsiveness when there are many markers.
        // It progressively adds markers to the map instead of blocking the UI.
        chunkedLoading
        iconCreateFunction={createMarkerClusterIcon}
        // Radius zero deliberately limits clustering to exact coordinate matches.
        maxClusterRadius={clusterRadius}
      >
        {points.map((point) => {
          const icon = getMarkerIcon(point.marker);

          return (
            <Marker
              key={point.id}
              ref={(marker) => setCsvMarkerValue(marker, point.marker)}
              position={[point.lat, point.lon]}
              {...(icon ? { icon } : {})}
              // Cluster mode deliberately bypasses proximity selection so
              // expansion and spiderfying retain their existing behavior.
              eventHandlers={{
                click: () => onMarkerSelect?.(point, [point]),
              }}
            />
          );
        })}
      </MarkerClusterGroup>
    );
  }

  return points.map((point) => {
    const icon = getMarkerIcon(point.marker);

    return (
      <Marker
        key={point.id}
        position={[point.lat, point.lon]}
        {...(icon ? { icon } : {})}
        eventHandlers={{ click: () => selectWithProximity(point) }}
      />
    );
  });
}
export default function GeoMap({
  points = [],
  regions = [],
  lines = [],

  // When true, markers within the configured radius are clustered visually;
  // radius zero limits clustering to markers with identical coordinates.
  // When false, markers are rendered normally (current behavior).
  getSourceRow,
  getFeatureDetails,
  clusterMarkersEnabled = false,
  clusterRadius = 80,   // default strength
  onViewportChange,
  onMarkerSelect,
  selectedMarker,
  zoneEditingEnabled = false,
  onZoneEditingToggle,
  getLogicalZone,
  updateLogicalZone,
  enabledDatasetIds = [],
  onZoneEditingError,
}) {
  const markerClusterGroupRef = useRef(null);
  const markerPoints = points.filter((p) => !p.image);
  // Data-source groups are already summarized, so keep them out of client clustering.
  const exactMarkerPoints = markerPoints.filter((p) => !isGroupedPointFeature(p));
  const groupedMarkerPoints = markerPoints.filter(isGroupedPointFeature);
  const imagePoints = points.filter((p) => !!p.image);

  // Hide the original cluster icon while MarkerClusterGroup spiderfies exact-overlap markers.
  useEffect(() => {
    const group = markerClusterGroupRef.current;
    if (!group) return undefined;

    const handleSpiderfied = (event) => {
      setClusterIconVisibility(event?.cluster, false);
    };

    const handleUnspiderfied = (event) => {
      setClusterIconVisibility(event?.cluster, true);
    };

    group.on("spiderfied", handleSpiderfied);
    group.on("unspiderfied", handleUnspiderfied);

    return () => {
      group.off("spiderfied", handleSpiderfied);
      group.off("unspiderfied", handleUnspiderfied);
    };
  }, [clusterMarkersEnabled, clusterRadius]);

  return (
    // MapContainer must have a fixed height and width.
    // If not, the map will not render correctly.
    <MapContainer
      // Initial center of the map.
      // This is Stockholm (latitude, longitude).
      center={[59.3293, 18.0686]}

      // Initial zoom level.
      // Lower value = more zoomed out.
      zoom={5}
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: "#ffffff",
      }}
      zoomControl={false}
    >
      <ViewportChangeReporter onViewportChange={onViewportChange} />
      <MapCoordinateControls
        zoneEditingEnabled={zoneEditingEnabled}
        onZoneEditingToggle={onZoneEditingToggle}
      />

      {/* Zoom controls moved away from the CSV overlay */}
      <ZoomControl position="bottomright" />

      {/* Built-in and user-configured raster layers share the Leaflet layer control. */}
      <MapTileLayers />

      {/* A map-native ring highlights selection without modifying marker icons. */}
      {selectedMarker && (
        <CircleMarker
          center={[selectedMarker.lat, selectedMarker.lon]}
          radius={MARKER_PROXIMITY_RADIUS_PIXELS}
          pathOptions={{
            color: "#facc15",
            weight: 4,
            opacity: 1,
            fill: false,
          }}
          interactive={false}
        />
      )}

      {/*
        Render markers for each point derived from enabled CSV files.

        Optional marker clustering.
        - When clustering is enabled, markers are grouped into clusters (Leaflet.markercluster behavior).
        - Clicking a cluster zooms in and reveals the markers inside.
        - When disabled, markers are shown normally (current behavior).
      */}
      <ExactPointMarkers
        points={exactMarkerPoints}
        clusterMarkersEnabled={clusterMarkersEnabled}
        clusterRadius={clusterRadius}
        markerClusterGroupRef={markerClusterGroupRef}
        onMarkerSelect={onMarkerSelect}
      />

      {/* Render grouped SQLite summaries as count markers, separate from exact marker clustering. */}
      {groupedMarkerPoints.map((p) => {
        const icon = getClusterMarkerIcon(p.marker, p.count);

        return (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            {...(icon ? { icon } : {})}
            eventHandlers={{ click: () => onMarkerSelect?.(p) }}
          />
        );
      })}

      {imagePoints.map((p) => (
        <ImageOverlay
          key={`image:${p.id}`}
          url={p.image}
          bounds={buildPointImageBounds(p)}
          interactive
          eventHandlers={{ click: () => onMarkerSelect?.(p) }}
        />
      ))}

      <EditableRegions
        regions={regions}
        enabled={zoneEditingEnabled}
        enabledDatasetIds={enabledDatasetIds}
        getLogicalZone={getLogicalZone}
        updateLogicalZone={updateLogicalZone}
        onError={onZoneEditingError}
        getSourceRow={getSourceRow}
        getFeatureDetails={getFeatureDetails}
      />

      {lines.map((line) => (
        <LayerGroup key={line.id}>
          <Polyline positions={line.coordinates} pathOptions={line.style}>
            <FeaturePopup
              feature={line}
              fallbackTitle="Line"
              getSourceRow={getSourceRow}
              getFeatureDetails={getFeatureDetails}
            />
          </Polyline>
          <LineArrowDecorator line={line} />
        </LayerGroup>
      ))}
    </MapContainer>
  );
}

function buildPointImageBounds(point) {
  // Build bounds from point and size.
  const latMeters = 111320;
  const lonMeters = 111320 * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.000001);

  const halfWidthDegrees = (point.imageWidthMeters / 2) / lonMeters;
  const heightDegrees = point.imageHeightMeters / latMeters;

  const south = point.lat;
  const north = point.lat + heightDegrees;
  const west = point.lon - halfWidthDegrees;
  const east = point.lon + halfWidthDegrees;

  return [
    [south, west],
    [north, east],
  ];
}
