"use strict";

const DEFAULT_REGION_STYLE = Object.freeze({
  color: "#3388ff",
  weight: 2,
  opacity: 1,
  fillColor: "#3388ff",
  fillOpacity: 0.25,
});

/** Rebuild materialized region parts for one persistent dataset. */
function rebuildSqliteDatasetRegions({ db, datasetId }) {
  requireOpenDatabase(db);
  const rows = db.prepare(`
    SELECT source_row_index, lat, lon, timeline_start_year, timeline_end_year,
           compact_json, row_json
    FROM features
    WHERE dataset_id = ?
    ORDER BY source_row_index
  `).all(datasetId);
  const groups = new Map();

  for (const stored of rows) {
    const compact = parseObject(stored.compact_json);
    if (String(compact.featureType ?? "").trim().toLowerCase() !== "region") continue;
    const featureId = normalizeString(compact.featureId);
    if (!featureId) continue;
    const part = normalizeString(compact.part) ?? "0";
    const key = `${featureId}\u0000${part}`;
    let group = groups.get(key);
    if (!group) {
      group = { featureId, part, vertices: [] };
      groups.set(key, group);
    }
    group.vertices.push({
      sourceRowIndex: Number(stored.source_row_index),
      order: parseOrder(compact.order),
      lat: Number(stored.lat),
      lon: Number(stored.lon),
      timelineStartYear: stored.timeline_start_year,
      timelineEndYear: stored.timeline_end_year,
      compact,
    });
  }

  db.prepare("DELETE FROM geometry_features WHERE dataset_id = ?").run(datasetId);
  const insert = db.prepare(`
    INSERT INTO geometry_features (
      dataset_id, feature_id, part, source_row_index, part_order_index,
      min_lat, max_lat, min_lon, max_lon, timeline_start_year,
      timeline_end_year, coordinates_json, style_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const group of groups.values()) {
    group.vertices.sort(compareVertices);
    if (group.vertices.length < 3) continue;
    const coordinates = group.vertices.map((vertex) => [vertex.lat, vertex.lon]);
    if (!sameCoordinate(coordinates[0], coordinates.at(-1))) {
      coordinates.push([...coordinates[0]]);
    }
    const bounds = getBounds(coordinates);
    const first = group.vertices[0];
    insert.run(
      datasetId,
      group.featureId,
      group.part,
      first.sourceRowIndex,
      first.sourceRowIndex,
      bounds.minLat,
      bounds.maxLat,
      bounds.minLon,
      bounds.maxLon,
      first.timelineStartYear,
      first.timelineEndYear,
      JSON.stringify(coordinates),
      JSON.stringify(resolveRegionStyle(group.vertices)),
    );
  }
}

/** Read every materialized part for one dataset-scoped logical region. */
function getSqliteLogicalZone({ db, datasetId, featureId }) {
  requireOpenDatabase(db);
  const normalizedDatasetId = requireString(datasetId);
  const normalizedFeatureId = requireString(featureId);
  const rows = db.prepare(`
    SELECT part, coordinates_json, style_json
    FROM geometry_features
    WHERE dataset_id = ? AND feature_id = ?
    ORDER BY part_order_index, part
  `).all(normalizedDatasetId, normalizedFeatureId);
  if (rows.length === 0) throw new Error("The requested logical zone is unavailable.");
  return {
    datasetId: normalizedDatasetId,
    featureId: normalizedFeatureId,
    parts: rows.map((row) => ({
      part: String(row.part),
      coordinates: normalizeCoordinates(parseArray(row.coordinates_json)),
      style: parseObject(row.style_json),
    })),
  };
}

/** Replace a complete logical zone in one better-sqlite3 transaction. */
function updateSqliteLogicalZone({ db, datasetId, featureId, parts }) {
  requireOpenDatabase(db);
  const storedZone = getSqliteLogicalZone({ db, datasetId, featureId });
  const submittedParts = normalizeParts(parts);
  validateParts(storedZone.parts, submittedParts);
  const verticesByPart = readLogicalZoneVertices(db, storedZone);
  const updateFeature = db.prepare(`
    UPDATE features SET lat = ?, lon = ?, row_json = ?
    WHERE dataset_id = ? AND source_row_index = ?
  `);
  const updateGeometry = db.prepare(`
    UPDATE geometry_features
    SET coordinates_json = ?, min_lat = ?, max_lat = ?, min_lon = ?, max_lon = ?
    WHERE dataset_id = ? AND feature_id = ? AND part = ?
  `);

  // better-sqlite3 rolls every source-row and part update back if any statement fails.
  const commit = db.transaction(() => {
    for (const part of submittedParts) {
      const vertices = verticesByPart.get(part.part);
      for (let index = 0; index < vertices.length; index += 1) {
        const vertex = vertices[index];
        const [lat, lon] = part.coordinates[index];
        vertex.row[vertex.latField] = coordinateLike(vertex.row[vertex.latField], lat);
        vertex.row[vertex.lonField] = coordinateLike(vertex.row[vertex.lonField], lon);
        updateFeature.run(lat, lon, JSON.stringify(vertex.row), storedZone.datasetId, vertex.sourceRowIndex);
      }
      const bounds = getBounds(part.coordinates);
      updateGeometry.run(
        JSON.stringify(part.coordinates),
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        storedZone.datasetId,
        storedZone.featureId,
        part.part,
      );
    }
  });
  commit();
  return getSqliteLogicalZone({ db, datasetId, featureId });
}

/** Recover source vertices in exactly the order used by the materialized part. */
function readLogicalZoneVertices(db, zone) {
  const rows = db.prepare(`
    SELECT source_row_index, compact_json, row_json
    FROM features WHERE dataset_id = ? ORDER BY source_row_index
  `).all(zone.datasetId);
  const verticesByPart = new Map(zone.parts.map((part) => [part.part, []]));
  for (const stored of rows) {
    const compact = parseObject(stored.compact_json);
    if (
      String(compact.featureType ?? "").trim().toLowerCase() !== "region"
      || normalizeString(compact.featureId) !== zone.featureId
    ) continue;
    const part = normalizeString(compact.part) ?? "0";
    if (!verticesByPart.has(part)) continue;
    const row = parseObject(stored.row_json);
    const latField = normalizeString(compact.latField);
    const lonField = normalizeString(compact.lonField);
    if (!latField || !lonField) throw new Error("Stored coordinate mapping is unavailable.");
    verticesByPart.get(part).push({
      sourceRowIndex: Number(stored.source_row_index),
      order: parseOrder(compact.order),
      row,
      latField,
      lonField,
    });
  }
  for (const part of zone.parts) {
    const vertices = verticesByPart.get(part.part);
    vertices.sort(compareVertices);
    if (
      vertices.length !== part.coordinates.length
      && vertices.length !== part.coordinates.length - 1
    ) throw new Error("Stored zone vertices are inconsistent.");
  }
  return verticesByPart;
}

/** Resolve one stable polygon style from the first populated value in source order. */
function resolveRegionStyle(vertices) {
  const values = vertices.map((vertex) => vertex.compact);
  return {
    color: firstString(values, "color") ?? DEFAULT_REGION_STYLE.color,
    weight: boundedNumber(firstValue(values, "weight"), 1, 20, DEFAULT_REGION_STYLE.weight),
    opacity: boundedNumber(firstValue(values, "opacity"), 0, 1, DEFAULT_REGION_STYLE.opacity),
    fillColor: firstString(values, "fillColor")
      ?? firstString(values, "color")
      ?? DEFAULT_REGION_STYLE.fillColor,
    fillOpacity: boundedNumber(
      firstValue(values, "fillOpacity"),
      0,
      1,
      DEFAULT_REGION_STYLE.fillOpacity,
    ),
  };
}

/** Normalize the client payload while retaining the complete ordered part list. */
function normalizeParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError("Zone parts are required.");
  return parts.map((part) => ({
    part: requireString(part?.part),
    coordinates: normalizeCoordinates(part?.coordinates),
  }));
}

/** Prevent adjustment requests from changing multipart identities or ring structure. */
function validateParts(stored, submitted) {
  if (stored.length !== submitted.length) throw new Error("The complete logical zone is required.");
  for (let index = 0; index < stored.length; index += 1) {
    if (
      stored[index].part !== submitted[index].part
      || stored[index].coordinates.length !== submitted[index].coordinates.length
      || !sameCoordinate(submitted[index].coordinates[0], submitted[index].coordinates.at(-1))
    ) throw new Error("The logical-zone structure cannot be changed.");
  }
}

function normalizeCoordinates(value) {
  if (!Array.isArray(value) || value.length < 4) throw new TypeError("A region ring is required.");
  return value.map((coordinate) => {
    const lat = Number(coordinate?.[0]);
    const lon = Number(coordinate?.[1]);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new TypeError("Zone coordinates are invalid.");
    }
    return [lat, lon];
  });
}

function getBounds(coordinates) {
  return coordinates.reduce((bounds, [lat, lon]) => ({
    minLat: Math.min(bounds.minLat, lat),
    maxLat: Math.max(bounds.maxLat, lat),
    minLon: Math.min(bounds.minLon, lon),
    maxLon: Math.max(bounds.maxLon, lon),
  }), { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
}

function compareVertices(left, right) {
  return (left.order ?? left.sourceRowIndex) - (right.order ?? right.sourceRowIndex)
    || left.sourceRowIndex - right.sourceRowIndex;
}

function parseOrder(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstValue(values, key) {
  return values.find((value) => value[key] != null && String(value[key]).trim() !== "")?.[key];
}

function firstString(values, key) {
  return normalizeString(firstValue(values, key));
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function coordinateLike(original, value) {
  return typeof original === "number" ? value : String(value);
}

function sameCoordinate(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left[0] === right[0] && left[1] === right[1];
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArray(value) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireString(value) {
  const normalized = normalizeString(value);
  if (!normalized) throw new TypeError("A logical-zone identifier is required.");
  return normalized;
}

function requireOpenDatabase(db) {
  if (!db?.open) throw new TypeError("An open SQLite database is required.");
}

module.exports = {
  getSqliteLogicalZone,
  rebuildSqliteDatasetRegions,
  updateSqliteLogicalZone,
};
