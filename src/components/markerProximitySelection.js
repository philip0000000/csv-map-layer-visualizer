export const MARKER_PROXIMITY_RADIUS_PIXELS = 18;

/**
 * Find visible markers inside a circular screen-pixel radius of the clicked marker.
 * The caller supplies the already filtered marker set and the current map projection.
 */
export function findMarkersNearClickedMarker(
  markers,
  clickedMarker,
  projectMarker,
  radius = MARKER_PROXIMITY_RADIUS_PIXELS,
) {
  if (
    !Array.isArray(markers) ||
    !clickedMarker ||
    typeof projectMarker !== 'function' ||
    !Number.isFinite(radius) ||
    radius < 0
  ) {
    return [];
  }

  const clickedPoint = projectMarker(clickedMarker);
  if (!isProjectedPoint(clickedPoint)) return [];

  const radiusSquared = radius * radius;
  const nearby = [];

  markers.forEach((marker, sourceIndex) => {
    const projectedPoint = projectMarker(marker);
    if (!isProjectedPoint(projectedPoint)) return;

    // Leaflet container points use screen pixels, so squared Euclidean distance
    // gives a circular hit area without converting the radius to map units.
    const deltaX = projectedPoint.x - clickedPoint.x;
    const deltaY = projectedPoint.y - clickedPoint.y;
    const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
    if (distanceSquared > radiusSquared) return;

    nearby.push({ marker, sourceIndex, distanceSquared });
  });

  nearby.sort((left, right) => {
    if (left.marker === clickedMarker) return -1;
    if (right.marker === clickedMarker) return 1;
    return left.distanceSquared - right.distanceSquared ||
      left.sourceIndex - right.sourceIndex;
  });

  return nearby.map(({ marker }) => marker);
}

/** Return whether a map projection produced finite screen-pixel coordinates. */
function isProjectedPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
