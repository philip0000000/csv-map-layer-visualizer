// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// TileLayer is used to load map tiles (images).
// Marker and Popup are used to show points on the map.
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

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
  const keys = Object.keys(row).filter(
    (k) => k !== latField && k !== lonField
  );

  // Keep only the first few fields to keep popup readable
  return keys.slice(0, limit).map((k) => [k, row[k]]);
}

export default function GeoMap({ points = [], latField = null, lonField = null }) {
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
    >
      {/*
        TileLayer defines where the map images come from.
        This uses free OpenStreetMap tiles.
        {s}, {z}, {x}, {y} are replaced automatically by Leaflet.
      */}
      <TileLayer
        // Required attribution for OpenStreetMap data.
        attribution="&copy; OpenStreetMap contributors"

        // Standard OpenStreetMap tile server URL.
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/*
        Render one marker for each point.
        Each point comes from one CSV row with valid lat/lon values.
      */}
      {points.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lon]}>
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
        </Marker>
      ))}
    </MapContainer>
  );
}


