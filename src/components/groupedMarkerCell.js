/**
 * Convert a grouped marker's saved viewport cell into Leaflet polygon corners.
 * The calculation is local and does not read SQLite when hover or focus changes.
 */
export function getGroupedMarkerCellPolygons(groupRef) {
  const bounds = groupRef?.bounds;
  const grid = groupRef?.grid;
  if (!isFiniteBounds(bounds) || !isFiniteGrid(grid)) return [];

  const crossesAntimeridian = bounds.west > bounds.east;
  const longitudeSpan = crossesAntimeridian
    ? 360 - bounds.west + bounds.east
    : bounds.east - bounds.west;
  const south = Math.min(
    bounds.north,
    bounds.south + (grid.cellLat * grid.cellHeight),
  );
  const north = Math.min(bounds.north, south + grid.cellHeight);
  const unwrappedWest = Math.min(
    bounds.west + longitudeSpan,
    bounds.west + (grid.cellLon * grid.cellWidth),
  );
  const unwrappedEast = Math.min(
    bounds.west + longitudeSpan,
    unwrappedWest + grid.cellWidth,
  );

  if (north <= south || unwrappedEast <= unwrappedWest) return [];

  // A cell that crosses 180 degrees is drawn as two adjacent polygons so
  // Leaflet does not connect its corners across the rest of the world.
  if (unwrappedWest < 180 && unwrappedEast > 180) {
    return [
      createCellPolygon(south, north, unwrappedWest, 180),
      createCellPolygon(south, north, -180, unwrappedEast - 360),
    ];
  }

  const west = unwrappedWest >= 180 ? unwrappedWest - 360 : unwrappedWest;
  const east = unwrappedEast > 180 ? unwrappedEast - 360 : unwrappedEast;
  return [createCellPolygon(south, north, west, east)];
}

/** Update hover/focus keys and report whether one marker remains active. */
export function updateGroupedMarkerCellInteractions(
  interactions,
  pointId,
  interaction,
  active,
) {
  const nextInteractions = new Set(interactions instanceof Set ? interactions : []);
  const interactionKey = `${pointId}:${interaction}`;
  if (active) nextInteractions.add(interactionKey);
  else nextInteractions.delete(interactionKey);

  return {
    interactions: nextInteractions,
    remainsActive: [...nextInteractions]
      .some((key) => key.startsWith(`${pointId}:`)),
  };
}

/** Return four geographic corners in Leaflet latitude/longitude order. */
function createCellPolygon(south, north, west, east) {
  return [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ];
}

function isFiniteBounds(bounds) {
  return ['north', 'south', 'east', 'west']
    .every((key) => Number.isFinite(bounds?.[key]));
}

function isFiniteGrid(grid) {
  return Number.isInteger(grid?.cellLat) && grid.cellLat >= 0
    && Number.isInteger(grid?.cellLon) && grid.cellLon >= 0
    && Number.isFinite(grid.cellHeight) && grid.cellHeight > 0
    && Number.isFinite(grid.cellWidth) && grid.cellWidth > 0;
}
