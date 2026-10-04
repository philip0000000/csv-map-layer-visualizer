import { MAX_GEOJSON_VALUE_CHARACTERS } from './geojsonStream.js';

/** GeoJSON geometry types accepted by both desktop and browser importers. */
export const GEOJSON_GEOMETRY_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString',
  'Polygon', 'MultiPolygon', 'GeometryCollection',
]);

/** Limit recursion independently of coordinate count to reject pathological input. */
export const MAX_GEOJSON_DEPTH = 64;

/** Validate collection metadata and reject declared projected coordinate systems. */
export function validateGeojsonDocumentMetadata(value) {
  validateBoundingBox(value);
  rejectProjectedCrs(value);
  return value;
}

/** RFC 7946 requires longitude/latitude; obsolete CRS declarations cannot trigger guessing. */
function rejectProjectedCrs(value) {
  if (!Object.hasOwn(value, 'crs') || value.crs == null) return;
  const name = value.crs?.properties?.name;
  if (!['urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'urn:ogc:def:crs:EPSG::4326'].includes(name)) {
    fail('GeoJSON must use WGS84 longitude/latitude; convert projected data before importing.');
  }
}

/** Refresh existing bounds after edits without adding metadata the source never contained. */
export function refreshGeojsonBboxes(value, recursive = true) {
  if (!value || typeof value !== 'object') return;
  if (recursive) {
    if (value.type === 'FeatureCollection') value.features.forEach(child => refreshGeojsonBboxes(child));
    else if (value.type === 'Feature') refreshGeojsonBboxes(value.geometry);
    else if (value.type === 'GeometryCollection') value.geometries.forEach(child => refreshGeojsonBboxes(child));
  }
  if (!Array.isArray(value.bbox)) return;
  const dimensions = value.bbox.length / 2;
  const minimum = Array(dimensions).fill(Infinity);
  const maximum = Array(dimensions).fill(-Infinity);
  visit(value);
  if (minimum.every(Number.isFinite) && maximum.every(Number.isFinite)) value.bbox = [...minimum, ...maximum];
  else delete value.bbox;

  function visit(object) {
    if (!object) return;
    if (object.type === 'FeatureCollection') object.features.forEach(visit);
    else if (object.type === 'Feature') visit(object.geometry);
    else if (object.type === 'GeometryCollection') object.geometries.forEach(visit);
    else coordinates(object.coordinates);
  }
  function coordinates(array) {
    if (!Array.isArray(array)) return;
    if (typeof array[0] === 'number') {
      for (let axis = 0; axis < dimensions; axis++) {
        if (!Number.isFinite(array[axis])) continue;
        minimum[axis] = Math.min(minimum[axis], array[axis]);
        maximum[axis] = Math.max(maximum[axis], array[axis]);
      }
    } else array.forEach(coordinates);
  }
}

/** Report a feature-local validation failure without leaking parser internals. */
export class GeojsonValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeojsonValidationError';
    this.code = 'invalid-geojson';
  }
}

/**
 * Validate a Feature or geometry while preserving JSON properties and foreign members.
 * The returned Feature is independent of input, allowing later edits without mutating
 * the imported document. Feature IDs are source metadata, never database identities.
 */
export function normalizeGeojsonFeature(value) {
  if (isRecord(value)) rejectProjectedCrs(value);
  if (!isRecord(value)) fail('A GeoJSON object is required.');
  const isFeature = value.type === 'Feature';
  if (!isFeature && !GEOJSON_GEOMETRY_TYPES.has(value.type)) {
    fail('Expected a GeoJSON Feature or geometry.');
  }
  if (isFeature) {
    if (!Object.hasOwn(value, 'geometry') || !Object.hasOwn(value, 'properties')) {
      fail('A Feature requires geometry and properties members.');
    }
    if (value.properties !== null && !isRecord(value.properties)) {
      fail('Feature properties must be an object or null.');
    }
    if (Object.hasOwn(value, 'id') && typeof value.id !== 'string'
      && !(typeof value.id === 'number' && Number.isFinite(value.id))) {
      fail('Feature id must be a string or finite number.');
    }
  }
  const feature = cloneJson(isFeature ? value : {
    type: 'Feature', properties: {}, geometry: value,
  });
  if (feature.geometry !== null) validateGeometry(feature.geometry, 0);
  validateBoundingBox(feature);
  return feature;
}

/**
 * Distinguish legacy custom text from intended embedded GeoJSON, with an explicit
 * override for ambiguous CSV cells. Identifiable malformed geometry must not fall
 * back to latitude/longitude and display a different shape silently.
 */
export function classifyCsvGeometry(value, interpretation = 'auto') {
  if (!['auto', 'legacy', 'geojson'].includes(interpretation)) {
    throw new TypeError('Geometry interpretation must be auto, legacy, or geojson.');
  }
  if (interpretation === 'legacy' || value == null || value === '') {
    return { kind: 'legacy' };
  }
  let parsed = value;
  if (typeof value === 'string') {
    if (value.length > MAX_GEOJSON_VALUE_CHARACTERS) {
      const type = value.match(/"type"\s*:\s*"([^"]+)"/)?.[1];
      return interpretation === 'auto' && !isSupportedType(type) ? { kind: 'legacy' }
        : { kind: 'invalid', warning: 'The geometry cell exceeds the supported 64 Mi character limit.' };
    }
    try {
      parsed = JSON.parse(value);
    } catch {
      // Match a declared type only; arbitrary text mentioning GeoJSON stays metadata.
      const match = value.match(/"type"\s*:\s*"([^"]+)"/);
      if (interpretation === 'auto' && !isSupportedType(match?.[1])) {
        return { kind: 'legacy' };
      }
      return { kind: 'invalid', warning: 'The geometry cell contains malformed GeoJSON.' };
    }
  }
  if (interpretation === 'auto' && !isSupportedType(parsed?.type)) {
    return { kind: 'legacy' };
  }
  try {
    return { kind: 'geojson', feature: normalizeGeojsonFeature(parsed), isFeature: parsed.type === 'Feature' };
  } catch (error) {
    if (!(error instanceof GeojsonValidationError)) throw error;
    return { kind: 'invalid', warning: error.message };
  }
}

/**
 * Enumerate renderable components with stable paths into the original geometry.
 * Coordinates are Leaflet latitude/longitude tuples; polygon rings remain nested
 * so holes cannot accidentally become filled independent regions. Altitude stays
 * in the authoritative Feature, rather than being discarded during rendering.
 */
export function getGeojsonComponents(feature) {
  const components = [];
  visit(feature.geometry, []);
  return components;

  function visit(geometry, path) {
    if (geometry === null) return;
    const add = (kind, coordinates, coordinatePath) => components.push({
      kind, path: coordinatePath, coordinates,
    });
    switch (geometry.type) {
      case 'Point':
        add('point', toLatLon(geometry.coordinates), [...path, 'coordinates']);
        break;
      case 'MultiPoint':
        geometry.coordinates.forEach((point, index) =>
          add('point', toLatLon(point), [...path, 'coordinates', index]));
        break;
      case 'LineString':
        add('line', geometry.coordinates.map(toLatLon), [...path, 'coordinates']);
        break;
      case 'MultiLineString':
        geometry.coordinates.forEach((line, index) =>
          add('line', line.map(toLatLon), [...path, 'coordinates', index]));
        break;
      case 'Polygon':
        if (geometry.coordinates.length) add('region', geometry.coordinates.map(ring => ring.map(toLatLon)),
          [...path, 'coordinates']);
        break;
      case 'MultiPolygon':
        geometry.coordinates.forEach((polygon, index) =>
          polygon.length && add('region', polygon.map(ring => ring.map(toLatLon)),
            [...path, 'coordinates', index]));
        break;
      case 'GeometryCollection':
        geometry.geometries.forEach((child, index) =>
          visit(child, [...path, 'geometries', index]));
        break;
      default:
        fail('Unsupported GeoJSON geometry type.');
    }
  }
}

/** Validate geometry structure and geographic positions without rounding or repair. */
function validateGeometry(geometry, depth) {
  if (depth > MAX_GEOJSON_DEPTH) fail('GeoJSON nesting exceeds the supported limit.');
  if (!isRecord(geometry) || !GEOJSON_GEOMETRY_TYPES.has(geometry.type)) {
    fail('Unsupported GeoJSON geometry type.');
  }
  validateBoundingBox(geometry);
  rejectProjectedCrs(geometry);
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case 'Point': validatePosition(coordinates); break;
    case 'MultiPoint': validateArray(coordinates, 0, validatePosition); break;
    case 'LineString': validateLine(coordinates); break;
    case 'MultiLineString': validateArray(coordinates, 0, validateLine); break;
    case 'Polygon': validatePolygon(coordinates); break;
    case 'MultiPolygon': validateArray(coordinates, 0, validatePolygon); break;
    case 'GeometryCollection':
      validateArray(geometry.geometries, 0, child => validateGeometry(child, depth + 1));
      break;
  }
}

/** Accept WGS84 longitude/latitude and optional finite altitude, never numeric strings. */
function validatePosition(position) {
  if (!Array.isArray(position) || position.length < 2 || position.length > 3
    || !position.every(value => typeof value === 'number' && Number.isFinite(value))
    || position[0] < -180 || position[0] > 180
    || position[1] < -90 || position[1] > 90) {
    fail('Coordinates must contain valid longitude, latitude, and optional altitude.');
  }
}

/** Require two or more positions for a connected line. */
function validateLine(line) {
  validateArray(line, 2, validatePosition);
}

/** Require closed polygon rings; accept either winding for compatibility with producers. */
function validatePolygon(polygon) {
  validateArray(polygon, 0, ring => {
    validateArray(ring, 4, validatePosition);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.length !== last.length || !first.every((value, index) => value === last[index])) {
      fail('GeoJSON polygon rings must be closed.');
    }
  });
}

/** Validate arrays at each geometry level, including valid empty multi-geometries. */
function validateArray(value, minimum, validateItem) {
  if (!Array.isArray(value) || value.length < minimum) fail('Invalid geometry coordinate structure.');
  value.forEach(validateItem);
}

/** Validate optional 2D/3D bounding boxes without assuming west is less than east. */
function validateBoundingBox(value) {
  if (!Object.hasOwn(value, 'bbox')) return;
  if (!Array.isArray(value.bbox) || ![4, 6].includes(value.bbox.length)
    || !value.bbox.every(number => typeof number === 'number' && Number.isFinite(number))) {
    fail('GeoJSON bbox must contain four or six finite numbers.');
  }
}

/** Clone JSON while rejecting non-JSON input rather than changing property types. */
function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value, (_key, member) => {
      if (typeof member === 'number' && !Number.isFinite(member)
        || ['undefined', 'function', 'symbol', 'bigint'].includes(typeof member)) {
        fail('GeoJSON must contain only JSON values.');
      }
      return member;
    }));
  } catch (error) {
    if (error instanceof GeojsonValidationError) throw error;
    fail('GeoJSON must contain an acyclic JSON document.');
  }
}

/** Recognize only the object types supported in a single compact CSV cell. */
function isSupportedType(type) {
  return type === 'Feature' || GEOJSON_GEOMETRY_TYPES.has(type);
}

/** Convert one validated geographic position for map rendering only. */
function toLatLon(position) {
  return [position[1], position[0]];
}

/** Reject arrays and null where the specification requires a JSON object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Throw one typed feature-local failure for importer warning handling. */
function fail(message) {
  throw new GeojsonValidationError(message);
}
