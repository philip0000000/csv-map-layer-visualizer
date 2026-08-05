import { useEffect, useRef, useState } from "react";
// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// TileLayer is used to load map tiles (images).
// Marker and Popup are used to show points on the map.
// LayersControl provides Leaflet's built-in "layers" button (base maps + overlays).
import {
  MapContainer,
  LayersControl,
  TileLayer,
  LayerGroup,
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
import {
  findMarkersNearClickedMarker,
  MARKER_PROXIMITY_RADIUS_PIXELS,
} from "./markerProximitySelection";

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
/**
 * Map tile providers.
 * We expose:
 * - Base layers (radio buttons): only one can be active at a time.
 * - Overlays (checkboxes): can be layered on top of any base layer.
 *
 * Notes:
 * - OSM is your current default.
 * - Esri World Imagery is a common "no key" satellite option.
 * - The "Labels + boundaries" overlay provides country borders + city/place names.
 */
const TILESETS = {
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
}) {
  const { BaseLayer, Overlay } = LayersControl;
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

      {/* Zoom controls moved away from the CSV overlay */}
      <ZoomControl position="bottomright" />

      {/*
        Leaflet built-in "layers" control:
        - Base layers (radio buttons) for Blank, Normal, or Satellite.
        - Overlay (checkbox) for labels/boundaries on top of either base layer.
      */}
      <LayersControl position="topright" collapsed={true}>
        {/* Base layer: blank white canvas with no tiles */}
        <BaseLayer name={BLANK_BASE_LAYER_NAME}>
          <LayerGroup />
        </BaseLayer>

        {/* Base layer: Normal map (default checked) */}
        <BaseLayer checked name={TILESETS.osm.name}>
          <TileLayer
            // Required attribution for OpenStreetMap data.
            attribution={TILESETS.osm.attribution}
            // Standard OpenStreetMap tile server URL.
            url={TILESETS.osm.url}
            maxZoom={TILESETS.osm.maxZoom}
          />
        </BaseLayer>

        {/* Base layer: Satellite imagery */}
        <BaseLayer name={TILESETS.satellite.name}>
          <TileLayer
            attribution={TILESETS.satellite.attribution}
            url={TILESETS.satellite.url}
            maxZoom={TILESETS.satellite.maxZoom}
          />
        </BaseLayer>

        {/* Overlay: country borders + city/place labels (works nicely on satellite) */}
        <Overlay name={TILESETS.labelsBoundaries.name} checked={false}>
          <TileLayer
            attribution={TILESETS.labelsBoundaries.attribution}
            url={TILESETS.labelsBoundaries.url}
            maxZoom={TILESETS.labelsBoundaries.maxZoom}
            // Keep overlay crisp and readable.
            // If you ever want it softer, drop opacity to ~0.85.
            opacity={1}
          />
        </Overlay>
      </LayersControl>

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

      {regions.map((region) => (
        <Polygon
          key={region.id}
          positions={region.coordinates}
          pathOptions={region.style}
        >
          <FeaturePopup
            feature={region}
            fallbackTitle="Region"
            getSourceRow={getSourceRow}
            getFeatureDetails={getFeatureDetails}
          />
        </Polygon>
      ))}

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
