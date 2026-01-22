// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// TileLayer is used to load map tiles (images).
// Marker and Popup are used to show points on the map.
// LayersControl provides Leaflet's built-in "layers" button (base maps + overlays).
import {
  MapContainer,
  LayersControl,
  TileLayer,
  Marker,
  Popup,
  ZoomControl,
} from "react-leaflet";

// MarkerClusterGroup is a React wrapper around Leaflet's marker clustering plugin.
// It groups nearby markers into clusters for readability and performance.
import MarkerClusterGroup from "react-leaflet-cluster";

/**
 * Build a list of fields to show in the popup.
 *
 * - row: one CSV row (object with key/value pairs)
 * - latField / lonField: column names used for coordinates
 * - limit: max number of fields to show
 *
 * Latitude and longitude fields are skipped,
 * because they are already shown at the top.
 */
function buildPopupFields(row, latField, lonField, limit = 8) {
  if (!row || typeof row !== "object") return [];

  // Get all column names except lat/lon
  const keys = Object.keys(row).filter((k) => k !== latField && k !== lonField);

  // Keep only the first few fields to keep popup readable
  return keys.slice(0, limit).map(
    (k) => [k, row[k]]
  );
}

/**
 * Build the popup content for one point.
 * Kept in a helper so the Marker and Clustered Marker render paths stay identical.
 */
function renderPointPopup(p, latField, lonField) {
  return (
    <Popup>
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Point</div>

        {/* Always show coordinates */}
        <div>
          <b>lat:</b> {p.lat}
        </div>
        <div>
          <b>lon:</b> {p.lon}
        </div>

        <hr style={{ opacity: 0.25 }} />

        {buildPopupFields(p.row, latField, lonField).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <b>{k}:</b> {String(v ?? "")}
          </div>
        ))}
      </div>
    </Popup>
  );
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

export default function GeoMap({
  points = [],
  latField = null,
  lonField = null,

  // When true, nearby markers are grouped into clusters (visual-only feature).
  // When false, markers are rendered normally (current behavior).
  clusterMarkersEnabled = false,
  clusterRadius = 80,   // default strength
}) {
  const { BaseLayer, Overlay } = LayersControl;

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

      // Make the map fill its parent container.
      style={{ height: "100%", width: "100%" }}

      // Disable default top-left zoom (it is in conflict with the CvsPanel).
      zoomControl={false}
    >
      {/* Zoom controls moved away from the CSV overlay */}
      <ZoomControl position="bottomright" />

      {/*
        Leaflet built-in "layers" control:
        - Base layers (radio buttons) for Normal vs Satellite.
        - Overlay (checkbox) for labels/boundaries on top of either base layer.
      */}
      <LayersControl position="topright" collapsed={true}>
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

      {/*
        Render markers for each point derived from the selected CSV file.

        Optional marker clustering.
        - When clustering is enabled, markers are grouped into clusters (Leaflet.markercluster behavior).
        - Clicking a cluster zooms in and reveals the markers inside.
        - When disabled, markers are shown normally (current behavior).
      */}
      {clusterMarkersEnabled ? (
        <MarkerClusterGroup
          // Force a re-init when clustering settings change.
          // Leaflet.markercluster does not always apply maxClusterRadius updates dynamically.
          key={`cluster:${clusterMarkersEnabled ? 1 : 0}:${clusterRadius}`}
          // chunkedLoading improves responsiveness when there are many markers.
          // It progressively adds markers to the map instead of blocking the UI.
          chunkedLoading
          maxClusterRadius={clusterRadius}
        >
          {points.map((p) => (
            <Marker key={p.id} position={[p.lat, p.lon]}>
              {renderPointPopup(p, latField, lonField)}
            </Marker>
          ))}
        </MarkerClusterGroup>
      ) : (
        points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon]}>
            {renderPointPopup(p, latField, lonField)}
          </Marker>
        ))
      )}
    </MapContainer>
  );
}


