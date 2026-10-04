import { autoDetectLatLon, parseFlexibleFloat, isValidLat, isValidLon } from '../components/geoColumns.js';
import { detectFeatureTypeField, getRowFeatureType } from '../components/featureTypes.js';
import { readRows } from './geojsonStorage.js';
import { getDatasetExportFileName } from './importFileFormats.js';
import { refreshGeojsonBboxes } from './geojson.js';

/**
 * Export current source geometry as a FeatureCollection. Canonical Features retain
 * typed JSON; legacy vertices are grouped by dataset-local feature ID and part.
 * CSV metadata remains strings. Resolved styles retain the displayed appearance;
 * differently styled region parts become separate Features with their original ID.
 */
export function exportDatasetGeojson(database, datasetId) {
  const dataset = readRows(database, 'SELECT * FROM datasets WHERE id = ?', [datasetId])[0];
  if (!dataset) throw new Error('The requested dataset is unavailable.');
  const headers = JSON.parse(dataset.columns_json);
  const mapping = dataset.coordinate_mapping_json ? JSON.parse(dataset.coordinate_mapping_json) : autoDetectLatLon(headers);
  const typeField = detectFeatureTypeField(headers);
  const native = /\.geojson(?:\.gz)?$/i.test(dataset.file_name);
  const features = [];
  let omittedParts = 0;
  const groups = new Map();
  // Materialized styles reflect the same validation and vertex order used by the map.
  const desktop = readRows(database, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'line_features'").length > 0;
  const styles = new Map(readRows(database, desktop
    ? "SELECT 'region' AS geometry_type, feature_id, part, style_json, coordinates_json, source_row_index, NULL AS arrow_mode FROM geometry_features WHERE dataset_id = ?"
    : 'SELECT geometry_type, feature_id, part, style_json, coordinates_json, source_row_index, arrow_mode FROM geometry_features WHERE dataset_id = ?', [datasetId])
    .map(row => [JSON.stringify([row.geometry_type, row.feature_id, row.part]), row]));
  if (desktop) {
    for (const row of readRows(database, 'SELECT feature_id, style_json, coordinates_json, source_row_index, arrow_mode FROM line_features WHERE dataset_id = ?', [datasetId])) {
      styles.set(JSON.stringify(['line', row.feature_id, '']), row);
    }
  }
  const rows = database.prepare(`SELECT s.source_row_index, s.row_json, g.feature_json, g.properties_json
    FROM source_rows s LEFT JOIN geojson_features g ON g.dataset_id = s.dataset_id AND g.source_row_index = s.source_row_index
    WHERE s.dataset_id = ? ORDER BY s.source_row_index`);
  try {
    rows.bind([datasetId]);
    while (rows.step()) {
      const stored = rows.getAsObject();
      const row = JSON.parse(stored.row_json);
      if (stored.feature_json) {
        const feature = JSON.parse(stored.feature_json);
        if (!native) {
          const properties = JSON.parse(stored.properties_json);
          feature.properties = properties;
        }
        features.push(feature);
        continue;
      }
      const lat = parseFlexibleFloat(row[mapping.latField]);
      const lon = parseFlexibleFloat(row[mapping.lonField]);
      if (!isValidLat(lat) || !isValidLon(lon)) continue;
      const type = getRowFeatureType(row, typeField) || 'point';
      if (type === 'point') {
        features.push({ type: 'Feature', properties: row, geometry: { type: 'Point', coordinates: [lon, lat] } });
      } else if (['line', 'region'].includes(type) && String(row.featureId ?? '').trim()) {
        const id = String(row.featureId).trim();
        const key = JSON.stringify([type, id]);
        if (!groups.has(key)) groups.set(key, { type, id, properties: { ...row }, parts: new Map() });
        const group = groups.get(key);
        // Preserve later metadata values only when the first vertex left them blank.
        for (const [name, value] of Object.entries(row)) {
          if (group.properties[name] === '') group.properties[name] = value;
        }
        const part = type === 'region' ? String(row.part ?? '').trim() || '0' : '';
        if (!group.parts.has(part)) group.parts.set(part, []);
        const order = parseFlexibleFloat(row.order);
        group.parts.get(part).push({ row, coordinates: [lon, lat], index: stored.source_row_index,
          order: Number.isFinite(order) ? order : null });
      }
    }
  } finally { rows.free(); }
  for (const group of groups.values()) {
    const parts = [...group.parts.entries()].map(([part, vertices]) => {
      vertices.sort((left, right) => {
        if (left.order !== null && right.order !== null) return left.order - right.order || left.index - right.index;
        if (left.order !== null) return -1;
        if (right.order !== null) return 1;
        return left.index - right.index;
      });
      const stored = styles.get(JSON.stringify([group.type, group.id, part]));
      const first = vertices.find(vertex => vertex.index === stored?.source_row_index) ?? vertices[0];
      const properties = group.type === 'line' ? { ...first.row } : { ...group.properties };
      if (group.type === 'line') {
        for (const vertex of vertices) {
          for (const [key, value] of Object.entries(vertex.row)) if (properties[key] === '') properties[key] = value;
        }
      }
      // Use resolved style values as CSV strings so reimport keeps the displayed style.
      if (stored) {
        for (const [key, value] of Object.entries(JSON.parse(stored.style_json))) properties[key] = String(value);
        if (group.type === 'line') properties.arrow = stored.arrow_mode ?? 'none';
      }
      // Stored coordinates also preserve the runtime's mixed explicit/source ordering.
      const coordinates = stored ? JSON.parse(stored.coordinates_json).map(([lat, lon]) => [lon, lat])
        : vertices.map(vertex => vertex.coordinates);
      return { coordinates, properties };
    });
    if (group.type === 'line') {
      if (parts[0].coordinates.length >= 2) features.push({ type: 'Feature', id: group.id, properties: parts[0].properties,
        geometry: { type: 'LineString', coordinates: parts[0].coordinates } });
    } else {
      const polygons = parts.filter(part => part.coordinates.length >= 3).filter(part => {
        const ring = part.coordinates;
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push([...ring[0]]);
        // Legacy CSV accepts some degenerate closed rings that RFC 7946 cannot represent.
        if (ring.length >= 4) return true;
        omittedParts++;
        return false;
      });
      const sharedProperties = polygons.length && polygons.every(part => JSON.stringify(part.properties) === JSON.stringify(polygons[0].properties));
      if (sharedProperties) features.push({ type: 'Feature', id: group.id, properties: polygons[0].properties,
        geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: [polygons[0].coordinates] }
          : { type: 'MultiPolygon', coordinates: polygons.map(part => [part.coordinates]) } });
      else for (const part of polygons) features.push({ type: 'Feature', id: group.id, properties: part.properties,
        geometry: { type: 'Polygon', coordinates: [part.coordinates] } });
    }
  }
  const document = readRows(database, 'SELECT metadata_json, geometry_edited FROM geojson_documents WHERE dataset_id = ?', [datasetId])[0];
  const metadata = document ? JSON.parse(document.metadata_json) : {};
  const collection = { ...metadata, type: 'FeatureCollection', features };
  if (document?.geometry_edited) refreshGeojsonBboxes(collection, false);
  return { datasetId, fileName: getDatasetExportFileName(dataset.file_name, 'geojson'),
    ...(omittedParts ? { warnings: [`GeoJSON export omitted ${omittedParts} legacy polygon part(s) with fewer than four closed-ring positions. CSV export retains their source rows.`] } : {}),
    geojsonText: JSON.stringify(collection) };
}
