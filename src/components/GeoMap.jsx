// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// TileLayer is used to load map tiles (images).
import { MapContainer, TileLayer } from 'react-leaflet';

// GeoMap is a simple map component.
// It only shows a base map for now.
// Other layers (points, lines, areas) will be added later.
export default function GeoMap() {
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
      style={{ height: '100%', width: '100%' }}
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
    </MapContainer>
  );
}


