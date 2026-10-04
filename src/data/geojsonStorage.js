import { getGeojsonComponents, refreshGeojsonBboxes } from './geojson.js';
import { getGeojsonComponentStyle, getFeatureTimeline, resolveEmbeddedGeojson } from './geojsonFeatureModel.js';
import { validatePolygonCoordinates } from './polygonCoordinates.js';

/**
 * Install additive, dataset-scoped GeoJSON storage. Existing source rows and legacy
 * geometry tables stay authoritative for legacy CSV; these tables retain complete
 * Features and indexed render components without expanding each vertex to a row.
 */
export function initializeGeojsonStorage(database) {
  database.run(`CREATE TABLE IF NOT EXISTS geojson_documents (
    dataset_id TEXT PRIMARY KEY REFERENCES datasets(id) ON DELETE CASCADE,
    metadata_json TEXT NOT NULL, geometry_edited INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS geojson_features (
    dataset_id TEXT NOT NULL, source_row_index INTEGER NOT NULL,
    feature_json TEXT NOT NULL, properties_json TEXT NOT NULL,
    PRIMARY KEY(dataset_id, source_row_index),
    FOREIGN KEY(dataset_id, source_row_index) REFERENCES source_rows(dataset_id, source_row_index) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS geojson_components (
    dataset_id TEXT NOT NULL, source_row_index INTEGER NOT NULL, component_index INTEGER NOT NULL,
    geometry_type TEXT NOT NULL, path_json TEXT NOT NULL, coordinates_json TEXT NOT NULL, style_json TEXT NOT NULL,
    min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL,
    timeline_start_year INTEGER, timeline_end_year INTEGER, arrow_mode TEXT,
    PRIMARY KEY(dataset_id, source_row_index, component_index),
    FOREIGN KEY(dataset_id, source_row_index) REFERENCES geojson_features(dataset_id, source_row_index) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_source_rows_feature_id ON source_rows(dataset_id, trim(CAST(json_extract(row_json, '$.featureId') AS TEXT)));
  CREATE INDEX IF NOT EXISTS idx_geojson_components_bounds ON geojson_components(dataset_id, min_lat, max_lat, min_lon, max_lon);`);
}

/** Rebuild compact records from retained CSV cells inside the caller's transaction. */
export function rebuildGeojsonFeatures(database, datasetId) {
  const fileName = readRows(database, 'SELECT file_name FROM datasets WHERE id = ?', [datasetId])[0]?.file_name;
  const native = /\.geojson(?:\.gz)?$/i.test(fileName);
  database.run('DELETE FROM geojson_features WHERE dataset_id = ?', [datasetId]);
  const counts = { point: 0, line: 0, region: 0 };
  const rows = database.prepare('SELECT source_row_index, row_json FROM source_rows WHERE dataset_id = ? ORDER BY source_row_index');
  try {
    rows.bind([datasetId]);
    while (rows.step()) {
      const stored = rows.getAsObject();
      const result = resolveEmbeddedGeojson(JSON.parse(stored.row_json), { native });
      if (result.kind !== 'geojson') continue;
      storeGeojsonFeature(database, datasetId, stored.source_row_index, result.feature, result.properties);
      for (const component of result.components) counts[component.kind]++;
    }
  } finally { rows.free(); }
  return counts;
}

/** Store one complete Feature plus bounded component records; the caller owns atomicity. */
export function storeGeojsonFeature(database, datasetId, rowIndex, feature, properties = feature.properties ?? {}) {
  database.run('INSERT INTO geojson_features VALUES (?, ?, ?, ?)',
    [datasetId, rowIndex, JSON.stringify(feature), JSON.stringify(properties)]);
  const timeline = getFeatureTimeline(properties);
  getGeojsonComponents(feature).forEach((component, index) => {
    const bounds = getCoordinateBounds(component.coordinates);
    if (!bounds) return;
    database.run('INSERT INTO geojson_components VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      datasetId, rowIndex, index, component.kind, JSON.stringify(component.path), JSON.stringify(component.coordinates),
      JSON.stringify(getGeojsonComponentStyle(properties, component.kind)),
      bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon,
      timeline?.startYear ?? null, timeline?.endYear ?? null,
      ['none', 'start', 'end', 'both'].includes(properties.arrow) ? properties.arrow : 'none',
    ]);
  });
}

/**
 * Read bounded viewport components. A source preview allows up to 10,000 points
 * plus 10,000 line/region components; complete polygon editing uses the zone query.
 */
export function queryGeojsonComponents(database, query = {}, sourceRef = null) {
  const clauses = sourceRef ? [] : ['d.enabled = 1'];
  const params = [];
  if (sourceRef) {
    clauses.push('c.dataset_id = ?', 'c.source_row_index = ?');
    params.push(sourceRef.datasetId, sourceRef.rowIndex);
  } else {
    const bounds = normalizeGeojsonBounds(query.bounds);
    if (!bounds) return { points: [], lines: [], regions: [], matching: 0 };
    clauses.push('c.max_lat >= ?', 'c.min_lat <= ?',
      bounds.west > bounds.east ? '(c.max_lon >= ? OR c.min_lon <= ?)' : '(c.max_lon >= ? AND c.min_lon <= ?)');
    params.push(bounds.south, bounds.north, bounds.west, bounds.east);
    if (Array.isArray(query.datasetIds)) {
      if (!query.datasetIds.length) return { points: [], lines: [], regions: [], matching: 0 };
      clauses.push(`c.dataset_id IN (${query.datasetIds.map(() => '?').join(',')})`);
      params.push(...query.datasetIds);
    }
    if (query.timeline?.timelineEnabled) {
      clauses.push('c.timeline_start_year <= ?', 'c.timeline_end_year >= ?');
      params.push(Math.max(query.timeline.endYear, query.timeline.startYear), Math.min(query.timeline.endYear, query.timeline.startYear));
    }
  }
  const from = `FROM geojson_components c JOIN datasets d ON d.id = c.dataset_id WHERE ${clauses.join(' AND ')}`;
  const counts = { point: 0, line: 0, region: 0 };
  for (const row of readRows(database, `SELECT c.geometry_type, COUNT(*) AS count ${from} GROUP BY c.geometry_type`, params)) {
    counts[row.geometry_type] = row.count;
  }
  const matching = counts.point + counts.line + counts.region;
  const budget = Math.min(10000, Math.max(1, Math.trunc(Number(query.renderBudget) || 1000)));
  const pointLimit = sourceRef ? 10000 : query.pointLimit ?? budget;
  const geometryLimit = sourceRef ? 10000 : query.geometryLimit ?? budget;
  const select = (filter, limit) => readRows(database,
    `SELECT c.* ${from} AND ${filter} ORDER BY c.dataset_id, c.source_row_index, c.component_index LIMIT ?`, [...params, limit]);
  const rows = [...select("c.geometry_type = 'point'", pointLimit), ...select("c.geometry_type != 'point'", geometryLimit)];
  const result = { points: [], lines: [], regions: [], matching, counts };
  for (const row of rows) result[row.geometry_type === 'point' ? 'points' : row.geometry_type === 'line' ? 'lines' : 'regions'].push(componentToFeature(row, getGeojsonParentId(database, row.dataset_id, row.source_row_index)));
  return result;
}

/** Add canonical components to legacy map results without reading complete source Features. */
export function mergeGeojsonMapResult(database, query, legacy) {
  const budget = Math.min(10000, Math.max(1, Math.trunc(Number(query.renderBudget) || 1000)));
  const compact = queryGeojsonComponents(database, { ...query,
    pointLimit: Math.max(0, budget - legacy.points.length),
    geometryLimit: Math.max(0, budget - legacy.lines.length - legacy.regions.length),
  });
  const added = compact.points.length + compact.lines.length + compact.regions.length;
  const hidden = compact.matching - added;
  const hiddenGeometry = (compact.counts?.line ?? 0) + (compact.counts?.region ?? 0) - compact.lines.length - compact.regions.length;
  return { ...legacy,
    points: [...legacy.points, ...compact.points], lines: [...legacy.lines, ...compact.lines], regions: [...legacy.regions, ...compact.regions],
    stats: { ...legacy.stats,
      totalMatchingCount: (legacy.stats?.totalMatchingCount ?? 0) + compact.matching,
      returnedCount: (legacy.stats?.returnedCount ?? 0) + added,
      totalMatchingLineCount: (legacy.stats?.totalMatchingLineCount ?? 0) + (compact.counts?.line ?? 0),
      totalMatchingRegionCount: (legacy.stats?.totalMatchingRegionCount ?? 0) + (compact.counts?.region ?? 0),
      returnedLineCount: (legacy.stats?.returnedLineCount ?? 0) + compact.lines.length,
      returnedRegionCount: (legacy.stats?.returnedRegionCount ?? 0) + compact.regions.length,
      hiddenByRenderBudget: (legacy.stats?.hiddenByRenderBudget ?? 0) + hidden,
      overBudget: legacy.stats?.overBudget || hidden > 0,
      limitedToRenderBudget: hidden > 0 ? budget : legacy.stats?.limitedToRenderBudget,
      hiddenGeometryCount: (legacy.stats?.hiddenGeometryCount ?? 0) + hiddenGeometry,
      geometryOverLimit: legacy.stats?.geometryOverLimit || hiddenGeometry > 0,
      geometryLimit: hiddenGeometry > 0 ? budget : legacy.stats?.geometryLimit,
    },
  };
}

/** Match wrapped Leaflet bounds, including viewports spanning several world copies. */
function normalizeGeojsonBounds(value) {
  if (!value || !['north', 'south', 'east', 'west'].every(key => Number.isFinite(Number(value[key])))) return null;
  const wrap = value => value >= -180 && value <= 180 ? value : ((value + 180) % 360 + 360) % 360 - 180;
  const wholeWorld = Number(value.east) - Number(value.west) >= 360;
  return {
    north: Math.min(90, Math.max(Number(value.north), Number(value.south))),
    south: Math.max(-90, Math.min(Number(value.north), Number(value.south))),
    east: wholeWorld ? 180 : wrap(Number(value.east)),
    west: wholeWorld ? -180 : wrap(Number(value.west)),
  };
}

/** Recover typed effective metadata without copying geometry into popup details. */
export function getGeojsonFeatureDetails(database, sourceRef) {
  const stored = readRows(database, 'SELECT feature_json, properties_json FROM geojson_features WHERE dataset_id = ? AND source_row_index = ?',
    [sourceRef.datasetId, sourceRef.rowIndex])[0];
  return stored ? { featureId: getGeojsonParentId(database, sourceRef.datasetId, sourceRef.rowIndex), row: JSON.parse(stored.properties_json),
    sourceFeatureId: JSON.parse(stored.feature_json).id ?? null, latField: null, lonField: null } : null;
}

/** Resolve all polygon components of a parent while excluding its point and line components. */
export function getGeojsonLogicalZone(database, { datasetId, featureId }) {
  const match = String(featureId).match(/^geojson:(\d+)(?::\d+)?$/);
  if (!match || getGeojsonParentId(database, datasetId, Number(match[1])) !== featureId) return null;
  const rows = readRows(database, `SELECT component_index, coordinates_json, style_json FROM geojson_components
    WHERE dataset_id = ? AND source_row_index = ? AND geometry_type = 'region' ORDER BY component_index`, [datasetId, Number(match[1])]);
  if (!rows.length) return null;
  return { datasetId, featureId, parts: rows.map(row => ({ part: String(row.component_index),
    coordinates: JSON.parse(row.coordinates_json), style: JSON.parse(row.style_json) })) };
}

/**
 * Replace polygon coordinates in the original Feature through their stable paths.
 * Altitude, holes, foreign members, properties, and non-polygon collection children
 * survive unchanged. The caller owns the surrounding transaction and rollback.
 */
export function updateGeojsonLogicalZone(database, request) {
  const zone = getGeojsonLogicalZone(database, request);
  if (!zone) return null;
  const rowIndex = Number(request.featureId.split(':')[1]);
  const stored = readRows(database, 'SELECT feature_json, properties_json FROM geojson_features WHERE dataset_id = ? AND source_row_index = ?',
    [request.datasetId, rowIndex])[0];
  const feature = JSON.parse(stored.feature_json);
  const parts = readRows(database, `SELECT component_index, path_json FROM geojson_components
    WHERE dataset_id = ? AND source_row_index = ? AND geometry_type = 'region'`, [request.datasetId, rowIndex]);
  if (!Array.isArray(request.parts) || request.parts.length !== parts.length) throw new TypeError('Every polygon component must be supplied.');
  const submitted = new Map(request.parts.map(part => [String(part.part), part.coordinates]));
  if (submitted.size !== parts.length) throw new TypeError('Polygon components must be unique.');
  for (const part of parts) {
    const coordinates = submitted.get(String(part.component_index));
    validatePolygonCoordinates(coordinates);
    const path = JSON.parse(part.path_json);
    let target = feature.geometry;
    for (const key of path.slice(0, -1)) target = target[key];
    const key = path.at(-1);
    target[key] = replaceCoordinates(target[key], coordinates);
    refreshGeojsonBboxes(target, false);
  }
  refreshCollectionBounds(feature.geometry);
  refreshGeojsonBboxes(feature, false);
  const source = JSON.parse(readRows(database, 'SELECT row_json FROM source_rows WHERE dataset_id = ? AND source_row_index = ?',
    [request.datasetId, rowIndex])[0].row_json);
  const wasFeature = JSON.parse(source.geometry).type === 'Feature';
  source.geometry = JSON.stringify(wasFeature ? feature : feature.geometry);
  database.run('UPDATE source_rows SET row_json = ? WHERE dataset_id = ? AND source_row_index = ?', [JSON.stringify(source), request.datasetId, rowIndex]);
  database.run('DELETE FROM geojson_features WHERE dataset_id = ? AND source_row_index = ?', [request.datasetId, rowIndex]);
  storeGeojsonFeature(database, request.datasetId, rowIndex, feature, JSON.parse(stored.properties_json));
  database.run('UPDATE geojson_documents SET geometry_edited = 1 WHERE dataset_id = ?', [request.datasetId]);
  return getGeojsonLogicalZone(database, request);
}

/** Refresh changed collection ancestors while preserving untouched children's original boxes. */
function refreshCollectionBounds(geometry) {
  if (geometry?.type !== 'GeometryCollection') return;
  geometry.geometries.forEach(refreshCollectionBounds);
  refreshGeojsonBboxes(geometry, false);
}

/** Keep coordinate/ring counts and altitude stable while swapping Leaflet axes back to GeoJSON. */
function replaceCoordinates(original, replacement) {
  if (typeof original[0] === 'number') return [replacement[1], replacement[0], ...original.slice(2)];
  if (!Array.isArray(replacement) || replacement.length !== original.length) throw new TypeError('Polygon topology cannot change during adjustment.');
  return original.map((value, index) => replaceCoordinates(value, replacement[index]));
}

/** Adapt stable parent/component identities and Leaflet coordinates to the existing map contract. */
function componentToFeature(row, parent) {
  const coordinates = JSON.parse(row.coordinates_json);
  const style = JSON.parse(row.style_json);
  const feature = { id: JSON.stringify(['geojson', row.dataset_id, parent, row.component_index]), featureId: parent, geojsonComponent: true, part: String(row.component_index),
    sourceRef: { datasetId: row.dataset_id, rowIndex: row.source_row_index },
    timelineExtent: { startYear: row.timeline_start_year, endYear: row.timeline_end_year } };
  if (row.geometry_type === 'point') return { ...feature, lat: coordinates[0], lon: coordinates[1], renderType: 'exact', count: 1, ...style };
  return { ...feature, coordinates, style, part: String(row.component_index), arrow: row.arrow_mode };
}

/** Calculate conservative bounds for points, lines, and all rings of a polygon. */
export function getCoordinateBounds(coordinates) {
  let bounds = null;
  visit(coordinates);
  return bounds;
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lat, lon] = value;
      if (!bounds) bounds = { minLat: lat, maxLat: lat, minLon: lon, maxLon: lon };
      else {
        bounds.minLat = Math.min(bounds.minLat, lat); bounds.maxLat = Math.max(bounds.maxLat, lat);
        bounds.minLon = Math.min(bounds.minLon, lon); bounds.maxLon = Math.max(bounds.maxLon, lon);
      }
    } else value.forEach(visit);
  }
}

/** Keep statement lifetime bounded for both sql.js and the desktop adapter. */
export function readRows(database, sql, params = []) {
  const statement = database.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally { statement.free(); }
}

/** Choose a stable parent name outside the dataset's arbitrary CSV feature IDs. */
function getGeojsonParentId(database, datasetId, rowIndex) {
  const base = `geojson:${rowIndex}`;
  let candidate = base;
  let suffix = 0;
  while (readRows(database, `SELECT 1 FROM source_rows WHERE dataset_id = ?
    AND trim(CAST(json_extract(row_json, '$.featureId') AS TEXT)) = ? LIMIT 1`, [datasetId, candidate]).length) {
    candidate = `${base}:${++suffix}`;
  }
  return candidate;
}
