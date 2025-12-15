import { MapContainer, TileLayer } from 'react-leaflet';

export default function GeoMap() {
  return (
    <MapContainer
      center={[59.3293, 18.0686]}
      zoom={5}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
    </MapContainer>
  );
}
