import { detectFeatureTypeField, getRowFeatureType } from '../../components/featureTypes.js';
import { isValidLat, isValidLon, parseFlexibleFloat } from '../../components/geoColumns.js';

/** Read every stored part for one dataset-scoped logical region. */
export function getBrowserSqliteLogicalZone(database, request = {}) {
  requireDatabase(database);
  const datasetId = normalizeRequiredString(request.datasetId);
  const featureId = normalizeRequiredString(request.featureId);
  const rows = readAll(database, `
    SELECT part, coordinates_json, style_json
    FROM geometry_features
    WHERE dataset_id = ? AND geometry_type = 'region' AND feature_id = ?
    ORDER BY part_order_index, part
  `, [datasetId, featureId]);
  if (rows.length === 0) throw zoneError('dataset-not-found');

  return {
    datasetId,
    featureId,
    parts: rows.map((row) => ({
      part: String(row.part),
      coordinates: parseCoordinates(row.coordinates_json),
      style: parseJsonObject(row.style_json),
    })),
  };
}

/** Atomically update all source vertices and compact parts for one logical zone. */
export function updateBrowserSqliteLogicalZone(database, request = {}) {
  requireDatabase(database);
  const storedZone = getBrowserSqliteLogicalZone(database, request);
  const submittedParts = normalizeSubmittedParts(request.parts);
  validateCompletePartSet(storedZone.parts, submittedParts);
  const sourceContext = readSourceContext(database, storedZone);
  let updateSourceRow = null;
  let updateGeometry = null;

  database.run('BEGIN TRANSACTION');
  try {
    updateSourceRow = database.prepare(`
      UPDATE source_rows
      SET row_json = ?
      WHERE dataset_id = ? AND source_row_index = ?
    `);
    updateGeometry = database.prepare(`
      UPDATE geometry_features
      SET coordinates_json = ?, min_lat = ?, max_lat = ?, min_lon = ?, max_lon = ?
      WHERE dataset_id = ? AND geometry_type = 'region' AND feature_id = ? AND part = ?
    `);

    for (const part of submittedParts) {
      const vertices = sourceContext.verticesByPart.get(part.part);
      const sourceCoordinates = part.coordinates.slice(0, vertices.length);
      for (let index = 0; index < vertices.length; index += 1) {
        const vertex = vertices[index];
        const [lat, lon] = sourceCoordinates[index];
        // Only coordinate fields change; every other imported CSV value is retained verbatim.
        vertex.row[sourceContext.latField] = formatCoordinateLike(
          vertex.row[sourceContext.latField],
          lat,
        );
        vertex.row[sourceContext.lonField] = formatCoordinateLike(
          vertex.row[sourceContext.lonField],
          lon,
        );
        updateSourceRow.run([
          JSON.stringify(vertex.row),
          storedZone.datasetId,
          vertex.sourceRowIndex,
        ]);
      }

      const bounds = getBounds(part.coordinates);
      updateGeometry.run([
        JSON.stringify(part.coordinates),
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        storedZone.datasetId,
        storedZone.featureId,
        part.part,
      ]);
    }
    database.run('COMMIT');
  } catch (error) {
    try {
      database.run('ROLLBACK');
    } catch {
      // Preserve the original transaction failure when rollback itself is unavailable.
    }
    throw error;
  } finally {
    updateSourceRow?.free();
    updateGeometry?.free();
  }

  return getBrowserSqliteLogicalZone(database, storedZone);
}

/** Reconstruct the authoritative source-row ordering used by geometry derivation. */
function readSourceContext(database, zone) {
  const metadata = readAll(database, `
    SELECT columns_json, coordinate_mapping_json
    FROM datasets
    WHERE id = ? AND import_state = 'complete'
  `, [zone.datasetId], 1)[0];
  if (!metadata) throw zoneError('dataset-not-found');
  const headers = parseJsonArray(metadata.columns_json);
  const mapping = parseJsonObject(metadata.coordinate_mapping_json);
  const featureTypeField = detectFeatureTypeField(headers);
  const latField = normalizeRequiredString(mapping.latField);
  const lonField = normalizeRequiredString(mapping.lonField);
  if (!featureTypeField || !latField || !lonField) throw zoneError('operation-failed');

  const verticesByPart = new Map(zone.parts.map((part) => [part.part, []]));
  const rows = readAll(database, `
    SELECT source_row_index, row_json
    FROM source_rows
    WHERE dataset_id = ?
    ORDER BY source_row_index
  `, [zone.datasetId]);
  for (const stored of rows) {
    const row = parseJsonObject(stored.row_json);
    if (
      getRowFeatureType(row, featureTypeField) !== 'region'
      || normalizeRequiredString(row.featureId) !== zone.featureId
    ) continue;
    const part = normalizeRequiredString(row.part) ?? '0';
    if (!verticesByPart.has(part)) continue;
    const lat = parseFlexibleFloat(row[latField]);
    const lon = parseFlexibleFloat(row[lonField]);
    if (!isValidLat(lat) || !isValidLon(lon)) continue;
    verticesByPart.get(part).push({
      sourceRowIndex: Number(stored.source_row_index),
      order: parseOrder(row.order),
      row,
    });
  }

  for (const part of zone.parts) {
    const vertices = verticesByPart.get(part.part);
    vertices.sort((left, right) => (
      (left.order ?? left.sourceRowIndex) - (right.order ?? right.sourceRowIndex)
      || left.sourceRowIndex - right.sourceRowIndex
    ));
    const coordinateCount = part.coordinates.length;
    const isClosed = coordinatesEqual(part.coordinates[0], part.coordinates.at(-1));
    if (
      vertices.length !== coordinateCount
      && !(isClosed && vertices.length === coordinateCount - 1)
    ) throw zoneError('operation-failed');
  }
  return { latField, lonField, verticesByPart };
}

/** Normalize the client payload without permitting part identities or rings to disappear. */
function normalizeSubmittedParts(value) {
  if (!Array.isArray(value) || value.length === 0) throw zoneError('operation-failed');
  return value.map((part) => ({
    part: normalizeRequiredString(part?.part),
    coordinates: normalizeCoordinates(part?.coordinates),
  }));
}

/** Require the submitted multipart structure to match the stored logical zone exactly. */
function validateCompletePartSet(storedParts, submittedParts) {
  if (storedParts.length !== submittedParts.length) throw zoneError('operation-failed');
  for (let index = 0; index < storedParts.length; index += 1) {
    const stored = storedParts[index];
    const submitted = submittedParts[index];
    if (
      stored.part !== submitted.part
      || stored.coordinates.length !== submitted.coordinates.length
      || !coordinatesEqual(submitted.coordinates[0], submitted.coordinates.at(-1))
    ) throw zoneError('operation-failed');
  }
}

function normalizeCoordinates(value) {
  if (!Array.isArray(value) || value.length < 4) throw zoneError('operation-failed');
  return value.map((coordinate) => {
    const lat = Number(coordinate?.[0]);
    const lon = Number(coordinate?.[1]);
    if (!isValidLat(lat) || !isValidLon(lon)) throw zoneError('operation-failed');
    return [lat, lon];
  });
}

function getBounds(coordinates) {
  const latitudes = coordinates.map(([lat]) => lat);
  const longitudes = coordinates.map(([, lon]) => lon);
  return {
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
    minLon: Math.min(...longitudes),
    maxLon: Math.max(...longitudes),
  };
}

function formatCoordinateLike(original, coordinate) {
  return typeof original === 'number' ? coordinate : String(coordinate);
}

function parseOrder(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinatesEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left[0] === right[0] && left[1] === right[1];
}

function parseCoordinates(value) {
  return normalizeCoordinates(parseJsonArray(value));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRequiredString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readAll(database, sql, parameters = [], maximumRows = Infinity) {
  const statement = database.prepare(sql);
  const rows = [];
  try {
    statement.bind(parameters);
    while (rows.length < maximumRows && statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A sql.js database with prepare() is required.');
  }
}

function zoneError(code) {
  const error = new Error('The logical zone operation failed.');
  error.code = code;
  return error;
}
