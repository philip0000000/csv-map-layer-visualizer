/** Expose every ring while retaining the legacy flat-ring input representation. */
export function polygonRings(coordinates) {
  return Array.isArray(coordinates?.[0]?.[0]) ? coordinates : [coordinates];
}

/** Validate every submitted ring without dropping invalid vertices or holes. */
export function validatePolygonCoordinates(coordinates) {
  const rings = polygonRings(coordinates);
  if (!rings.length) throw new TypeError('A polygon requires at least one ring.');
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) throw new TypeError('A polygon ring requires four coordinates.');
    for (const position of ring) {
      if (!Array.isArray(position) || position.length !== 2
        || !position.every(Number.isFinite) || Math.abs(position[0]) > 90 || Math.abs(position[1]) > 180) {
        throw new TypeError('A polygon coordinate must contain valid latitude and longitude.');
      }
    }
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new TypeError('A polygon ring must be closed.');
  }
  return coordinates;
}
