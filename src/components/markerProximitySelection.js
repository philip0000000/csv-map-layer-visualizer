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

/**
 * Partition visible exact markers into deterministic screen-space proximity groups.
 * The visually topmost marker becomes the representative and every marker is
 * assigned once, even when several 18-pixel neighborhoods overlap.
 */
export function groupMarkersByProximity(
  markers,
  projectMarker,
  radius = MARKER_PROXIMITY_RADIUS_PIXELS,
) {
  if (
    !Array.isArray(markers) ||
    typeof projectMarker !== 'function' ||
    !Number.isFinite(radius) ||
    radius < 0
  ) {
    return [];
  }

  const projectedMarkers = markers.map((marker, sourceIndex) => ({
    marker,
    sourceIndex,
    point: projectMarker(marker),
  })).filter(({ point }) => isProjectedPoint(point));

  // Leaflet positions markers by their projected Y coordinate. A marker lower
  // on screen is placed above one higher up; source order breaks exact ties.
  projectedMarkers.sort((left, right) =>
    right.point.y - left.point.y || right.sourceIndex - left.sourceIndex
  );

  const radiusSquared = radius * radius;
  const assigned = new Set();
  const groups = [];

  projectedMarkers.forEach((representative) => {
    if (assigned.has(representative.sourceIndex)) return;

    const members = [];
    projectedMarkers.forEach((candidate) => {
      if (assigned.has(candidate.sourceIndex)) return;
      const deltaX = candidate.point.x - representative.point.x;
      const deltaY = candidate.point.y - representative.point.y;
      if ((deltaX * deltaX) + (deltaY * deltaY) > radiusSquared) return;

      assigned.add(candidate.sourceIndex);
      members.push(candidate.marker);
    });

    groups.push({ representative: representative.marker, members });
  });

  return groups;
}

/** Return whether a map projection produced finite screen-pixel coordinates. */
function isProjectedPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
