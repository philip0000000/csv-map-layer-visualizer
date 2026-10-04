/** Find the smallest continuous longitude interval, including dateline crossings. */
export function geometryNavigationBounds(coordinates) {
  // Polygon holes introduce a ring level; navigation uses every geographic tuple.
  if (Array.isArray(coordinates?.[0]?.[0])) coordinates = coordinates.flat();
  if (!coordinates?.length) throw new Error('This feature has no map geometry.');
  let south = 90;
  let north = -90;
  const longitudes = coordinates.map(([lat, lon]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) {
      throw new Error('This feature has invalid map geometry.');
    }
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    return ((lon % 360) + 360) % 360;
  }).sort((a, b) => a - b);
  let largestGap = -1;
  let start = 0;
  longitudes.forEach((lon, index) => {
    const next = index + 1 < longitudes.length ? longitudes[index + 1] : longitudes[0] + 360;
    if (next - lon > largestGap) {
      largestGap = next - lon;
      start = next % 360;
    }
  });
  const west = start > 180 ? start - 360 : start;
  return { south, north, west, east: west + 360 - largestGap };
}

/** Resolve fresh complete geometry rather than the viewport's limited render snapshot. */
export async function getFeatureNavigationTarget(dataSource, feature) {
  if (feature.groupRef) {
    const bounds = await dataSource.getGroupBounds({ groupRef: feature.groupRef });
    if (!bounds) throw new Error('This group no longer has map features.');
    return { bounds };
  }
  const current = await dataSource.getPreviewFeature({ sourceRef: feature.sourceRef });
  if (!current) throw new Error('This feature is no longer available on the map.');
  if (feature.geojsonComponent === true) {
    // A mixed parent's Preview row resolves to its first component. Navigation
    // must keep the clicked component's kind instead of switching to that first point.
    if (Array.isArray(feature.coordinates?.[0]?.[0])) {
      const zone = await dataSource.getLogicalZone({ datasetId: feature.sourceRef.datasetId, featureId: feature.featureId });
      return { bounds: geometryNavigationBounds(zone?.parts?.flatMap(part => part.coordinates)) };
    }
    if (feature.coordinates) return { bounds: geometryNavigationBounds(feature.coordinates) };
    return { point: [feature.lat, feature.lon] };
  }
  if (current.selectionKind === 'region') {
    const zone = await dataSource.getLogicalZone({ datasetId: current.sourceRef.datasetId, featureId: current.featureId });
    return { bounds: geometryNavigationBounds(zone?.parts?.flatMap((part) => part.coordinates)) };
  }
  if (current.selectionKind === 'line') return { bounds: geometryNavigationBounds(current.coordinates) };
  if (!Number.isFinite(current.lat) || !Number.isFinite(current.lon)) {
    throw new Error('This feature has no map coordinates.');
  }
  return { point: [current.lat, current.lon] };
}

/** Keep features in the map space remaining to the right of both overlay panels. */
export function navigateToFeature(map, target, panelRight) {
  const rect = map.getContainer().getBoundingClientRect();
  const left = Math.max(0, panelRight - rect.left);
  if (rect.width - left <= 48 || rect.height <= 48) {
    throw new Error('Widen the window or narrow the panels to view this feature.');
  }
  if (target.point) {
    const zoom = map.getZoom();
    const projected = map.project(target.point, zoom);
    map.setView(map.unproject([projected.x - left / 2, projected.y], zoom), zoom, { animate: false });
  } else {
    const { south, north, west, east } = target.bounds;
    map.fitBounds([[south, west], [north, east]], {
      paddingTopLeft: [left + 24, 24], paddingBottomRight: [24, 24],
      maxZoom: map.getMaxZoom(), animate: false,
    });
  }
}
