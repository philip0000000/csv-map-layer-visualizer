import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapNavigationBridge } from './MapNavigationBridge';
// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// LayerGroup keeps each line and its optional arrow decorators together.
// Shape selection uses non-interactive paths above the normal geometry layers.
import {
  MapContainer,
  LayerGroup,
  Marker,
  ImageOverlay,
  CircleMarker,
  Polygon,
  Polyline,
  Pane,
  ZoomControl,
  useMap,
} from "react-leaflet";

// MarkerClusterGroup is a React wrapper around Leaflet's marker clustering plugin.
// It groups nearby markers into clusters for readability and performance.
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import HeatmapLayer from './HeatmapLayer';
import { DEFAULT_HEAT_RADIUS } from './heatmap';
import "leaflet-polylinedecorator";

import { getClusterMarkerIcon, getCountedMarkerIcon, getMarkerIcon } from "./markerIcons";
import { getDisplayedRegion, isFeatureSelected } from "./featureSelection";
import {
  getGroupedMarkerCellPolygons,
  updateGroupedMarkerCellInteractions,
} from "./groupedMarkerCell";
import MapCoordinateControls from "./MapCoordinateControls";
import MapTileLayers from "./MapTileLayers";
import { INITIAL_MAP_MAX_ZOOM } from "./mapZoomLimits";
import {
  groupMarkersByProximity,
  MARKER_PROXIMITY_RADIUS_PIXELS,
} from "./markerProximitySelection";
import {
  calculateZoneTransformCenter,
  getZoneDragOperation,
  isEditableInteractionTarget,
  shouldApplyZoneCommit,
  transformZoneParts,
} from "./zoneTransform";

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

/** Add a contrast edge and yellow halo while retaining the feature's original stroke. */
function ShapeSelectionHighlight({ feature, kind }) {
  const Shape = kind === "region" ? Polygon : Polyline;
  const weight = Number.isFinite(feature.style?.weight) ? feature.style.weight : 3;
  return (
    <>
      {[{ color: "#0f172a", weight: weight + 8 },
        { color: "#facc15", weight: weight + 6 },
        { ...feature.style, weight }].map((style, index) => (
        <Shape
          key={index}
          positions={feature.coordinates}
          pane="featureSelection"
          interactive={false}
          pathOptions={{ ...style, fill: false, opacity: index === 2 ? feature.style?.opacity ?? 1 : 1 }}
        />
      ))}
    </>
  );
}

/** Keep CSV arrow styling visible above selection halos without capturing clicks. */
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
            pane: "featureArrows",
            interactive: false,
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
            pane: "featureArrows",
            interactive: false,
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
  selectedFeature,
  onFeatureSelect,
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

  const selectedDatasetId = selectedFeature?.selectionKind === "region"
    ? selectedFeature.sourceRef?.datasetId : null;
  const selectedFeatureId = selectedFeature?.selectionKind === "region"
    ? selectedFeature.featureId : null;

  useEffect(() => {
    // A panel close, another feature selection, or edit-mode exit cancels the old editor.
    const requestId = ++selectionRequestRef.current;
    zoneInteractionRef.current += 1;
    endDragInteraction();
    storePreviewParts(null);
    storeSelectedZone(null);
    if (!enabled || !selectedDatasetId || !selectedFeatureId
      || !enabledDatasetIds.includes(selectedDatasetId) || !getLogicalZone) return;

    Promise.resolve().then(() => getLogicalZone({
      datasetId: selectedDatasetId, featureId: selectedFeatureId,
    })).then((zone) => {
      if (selectionRequestRef.current === requestId) {
        storeSelectedZone(zone?.parts?.length ? zone : null);
      }
    }).catch((error) => {
      if (selectionRequestRef.current === requestId) onError?.(error);
    });
    return () => { selectionRequestRef.current += 1; };
  }, [enabled, enabledDatasetIds, selectedDatasetId, selectedFeatureId,
    getLogicalZone, endDragInteraction, onError]);

  /** Ordinary and edit-mode clicks select the same logical zone and reveal its details. */
  function selectRegion(region, event) {
    if (enabled) L.DomEvent.stopPropagation(event.originalEvent);
    onFeatureSelect?.({ ...region, selectionKind: "region" });
  }

  /** Lock one operation at primary-button down and preview only in memory. */
  function beginRegionDrag(region, event) {
    if (!enabled || event.originalEvent?.button !== 0 || dragRef.current
      || !isFeatureSelected(region, "region", selectedFeature)) return;
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

  return (
    <>
      {regions.map((sourceRegion) => {
        // The editor may load every part for a transform, but only query-visible parts render.
        const region = getDisplayedRegion(sourceRegion, selectedFeature, selectedZone, previewParts);
        return (
          <LayerGroup key={region.id}>
            <Polygon
              positions={region.coordinates}
              pathOptions={region.style}
              bubblingMouseEvents={!enabled}
              eventHandlers={{
                click: (event) => selectRegion(sourceRegion, event),
                mousedown: (event) => beginRegionDrag(sourceRegion, event),
              }}
            />
            {isFeatureSelected(region, "region", selectedFeature) && (
              <ShapeSelectionHighlight feature={region} kind="region" />
            )}
          </LayerGroup>
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
  const [, setProjectionRevision] = useState(0);

  useEffect(() => {
    if (clusterMarkersEnabled) return undefined;
    const refreshProjection = () => setProjectionRevision((revision) => revision + 1);
    map.on("zoomend", refreshProjection);
    return () => map.off("zoomend", refreshProjection);
  }, [clusterMarkersEnabled, map]);

  const proximityGroups = clusterMarkersEnabled
    ? []
    : groupMarkersByProximity(
      points,
      (marker) => map.latLngToContainerPoint([marker.lat, marker.lon]),
    );

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

  return proximityGroups.map(({ representative, members }) => {
    const icon = getCountedMarkerIcon(representative.marker, members.length);

    return (
      <Marker
        key={representative.id}
        position={[representative.lat, representative.lon]}
        {...(icon ? { icon } : {})}
        eventHandlers={{
          // The displayed group and click selection share the same 18-pixel rule.
          click: () => onMarkerSelect?.(representative, members),
        }}
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
  // When false, exact markers use the shared proximity-grouping behavior.
  clusterMarkersEnabled = false,
  clusterRadius = 80,   // default strength
  heatmapEnabled = false,
  heatmapShowMarkers = true,
  heatRadius = DEFAULT_HEAT_RADIUS,
  heatPoints = points,
  onViewportChange,
  onNavigationReady,
  onFeatureSelect,
  selectedFeature,
  zoneEditingEnabled = false,
  onZoneEditingToggle,
  getLogicalZone,
  updateLogicalZone,
  enabledDatasetIds = [],
  onZoneEditingError,
}) {
  /** Point selections retain nearby-marker lists and their existing grouping behavior. */
  const onMarkerSelect = (point, nearbyMarkers) => onFeatureSelect?.(
    { ...point, selectionKind: "point" }, nearbyMarkers,
  );
  const markerClusterGroupRef = useRef(null);
  const groupedCellInteractionsRef = useRef(new Set());
  const [activeGroupedCell, setActiveGroupedCell] = useState(null);
  const showPointMarkers = !heatmapEnabled || heatmapShowMarkers;
  const markerPoints = showPointMarkers ? points.filter((p) => !p.image) : [];
  // Data-source groups are already summarized, so keep them out of client clustering.
  const exactMarkerPoints = markerPoints.filter((p) => !isGroupedPointFeature(p));
  const groupedMarkerPoints = markerPoints.filter(isGroupedPointFeature);
  const imagePoints = showPointMarkers ? points.filter((p) => !!p.image) : [];
  const activeGroupedCellPolygons = useMemo(
    () => getGroupedMarkerCellPolygons(activeGroupedCell?.groupRef),
    [activeGroupedCell],
  );

  /** Keep the cell visible while its marker is hovered, focused, or both. */
  function setGroupedCellInteraction(point, interaction, active) {
    const nextState = updateGroupedMarkerCellInteractions(
      groupedCellInteractionsRef.current,
      point.id,
      interaction,
      active,
    );
    groupedCellInteractionsRef.current = nextState.interactions;
    if (active) {
      setActiveGroupedCell(point);
      return;
    }

    setActiveGroupedCell((current) => {
      if (current?.id !== point.id) return current;
      return nextState.remainsActive ? current : null;
    });
  }

  useEffect(() => {
    // A relative grid id can be reused after a pan, so refresh the saved bounds
    // or remove an overlay whose representative left the returned map view.
    setActiveGroupedCell((current) => {
      if (!current) return null;
      const replacement = points.find((point) => (
        point.id === current.id && isGroupedPointFeature(point)
      ));
      if (replacement) return replacement;
      groupedCellInteractionsRef.current.clear();
      return null;
    });
  }, [points]);

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
  }, [clusterMarkersEnabled, clusterRadius, showPointMarkers]);

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
      // Keep clustering safe before the active background synchronizes its own limit.
      maxZoom={INITIAL_MAP_MAX_ZOOM}
      // Tile layers repeat horizontally, but markers exist on one world copy.
      // Recenter wrapped pans so overlays remain aligned at very low zoom.
      worldCopyJump
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: "#ffffff",
      }}
      zoomControl={false}
    >
      <ViewportChangeReporter onViewportChange={onViewportChange} />
      <MapNavigationBridge onReady={onNavigationReady} />
      <MapCoordinateControls
        zoneEditingEnabled={zoneEditingEnabled}
        onZoneEditingToggle={onZoneEditingToggle}
      />

      {/* Zoom controls moved away from the CSV overlay */}
      <ZoomControl position="bottomright" />

      <Pane name="featureSelection" style={{ zIndex: 450, pointerEvents: "none" }} />
      <Pane name="featureArrows" style={{ zIndex: 460, pointerEvents: "none" }} />
      {/* Built-in and user-configured raster layers share the Leaflet layer control. */}
      <MapTileLayers />
      {heatmapEnabled && <HeatmapLayer points={heatPoints} radius={heatRadius} />}

      {/* A map-native ring highlights selection without modifying marker icons. */}
      {showPointMarkers && selectedFeature && selectedFeature.selectionKind === "point" && (
        <CircleMarker
          center={[selectedFeature.lat, selectedFeature.lon]}
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

      {/* Preview can select a shape omitted by the viewport render budget. */}
      {selectedFeature?.selectionKind === "line"
        && !lines.some((line) => line.id === selectedFeature.id)
        && <ShapeSelectionHighlight feature={selectedFeature} kind="line" />}
      {selectedFeature?.selectionKind === "region"
        && !regions.some((region) => region.id === selectedFeature.id)
        && <ShapeSelectionHighlight feature={selectedFeature} kind="region" />}

      {/* The saved grid cell is highlighted locally; hover never queries SQLite. */}
      {showPointMarkers && activeGroupedCellPolygons.map((positions, index) => (
        <Polygon
          key={`group-cell:${activeGroupedCell.id}:${index}`}
          positions={positions}
          pathOptions={{
            color: "#2563eb",
            weight: 2,
            opacity: 0.9,
            fillColor: "#3b82f6",
            fillOpacity: 0.18,
          }}
          interactive={false}
        />
      ))}

      {/*
        Render markers for each point derived from enabled CSV files.

        Optional marker clustering.
        - When clustering is enabled, markers are grouped into clusters (Leaflet.markercluster behavior).
        - Clicking a cluster zooms in and reveals the markers inside.
        - When disabled, exact markers are combined into 18-pixel proximity groups.
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
        const icon = getCountedMarkerIcon(p.marker, p.count);

        return (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            {...(icon ? { icon } : {})}
            eventHandlers={{
              click: () => onMarkerSelect?.(p),
              mouseover: () => setGroupedCellInteraction(p, "hover", true),
              mouseout: () => setGroupedCellInteraction(p, "hover", false),
              focus: () => setGroupedCellInteraction(p, "focus", true),
              blur: () => setGroupedCellInteraction(p, "focus", false),
            }}
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
        selectedFeature={selectedFeature}
        onFeatureSelect={onFeatureSelect}
      />

      {lines.map((line) => (
        <LayerGroup key={line.id}>
          <Polyline
            positions={line.coordinates}
            pathOptions={line.style}
            eventHandlers={{ click: () => onFeatureSelect?.({ ...line, selectionKind: "line" }) }}
          />
          {isFeatureSelected(line, "line", selectedFeature) && (
            <ShapeSelectionHighlight feature={line} kind="line" />
          )}
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
