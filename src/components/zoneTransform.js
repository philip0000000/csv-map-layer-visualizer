const EARTH_RADIUS_METERS = 6371008.8;
const MIN_TRANSFORM_RADIUS_METERS = 0.5;
const MIN_SCALE_FACTOR = 0.000001;

/** Calculate one local-projection centre from every non-duplicated zone vertex. */
export function calculateZoneTransformCenter(parts) {
  const vertices = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    const coordinates = Array.isArray(part?.coordinates) ? part.coordinates : [];
    const limit = isClosedRing(coordinates) ? coordinates.length - 1 : coordinates.length;
    for (let index = 0; index < limit; index += 1) {
      const coordinate = normalizeCoordinate(coordinates[index]);
      if (coordinate) vertices.push(coordinate);
    }
  }
  if (vertices.length === 0) return null;

  // A circular longitude mean keeps small zones near the antimeridian together.
  let latitudeTotal = 0;
  let longitudeSinTotal = 0;
  let longitudeCosTotal = 0;
  for (const [latitude, longitude] of vertices) {
    latitudeTotal += latitude;
    const longitudeRadians = degreesToRadians(longitude);
    longitudeSinTotal += Math.sin(longitudeRadians);
    longitudeCosTotal += Math.cos(longitudeRadians);
  }
  return {
    lat: latitudeTotal / vertices.length,
    lng: radiansToDegrees(Math.atan2(longitudeSinTotal, longitudeCosTotal)),
  };
}

/** Resolve a complete multipart preview from the operation fixed at drag start. */
export function transformZoneParts(parts, { operation, center, start, current } = {}) {
  if (!['move', 'rotate', 'scale'].includes(operation)) return null;
  const normalizedCenter = normalizeLatLng(center);
  const normalizedStart = normalizeLatLng(start);
  const normalizedCurrent = normalizeLatLng(current);
  if (!normalizedCenter || !normalizedStart || !normalizedCurrent) return null;

  const startVector = projectLatLng(normalizedStart, normalizedCenter);
  const currentVector = projectLatLng(normalizedCurrent, normalizedCenter);
  let applyVector;

  if (operation === 'move') {
    const deltaX = currentVector.x - startVector.x;
    const deltaY = currentVector.y - startVector.y;
    applyVector = ({ x, y }) => ({ x: x + deltaX, y: y + deltaY });
  } else {
    // Rotation and scale both use the pointer vector from the one shared zone centre.
    const startDistance = Math.hypot(startVector.x, startVector.y);
    if (startDistance < MIN_TRANSFORM_RADIUS_METERS) return null;

    if (operation === 'rotate') {
      // Subtract polar angles so multipart geometry rotates as one rigid shape.
      const angle = Math.atan2(currentVector.y, currentVector.x)
        - Math.atan2(startVector.y, startVector.x);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      applyVector = ({ x, y }) => ({
        x: x * cosine - y * sine,
        y: x * sine + y * cosine,
      });
    } else {
      // A radial-distance ratio applies one uniform scale to every part and vertex.
      const scale = Math.hypot(currentVector.x, currentVector.y) / startDistance;
      if (!Number.isFinite(scale) || scale < MIN_SCALE_FACTOR) return null;
      applyVector = ({ x, y }) => ({ x: x * scale, y: y * scale });
    }
  }

  const transformed = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!Array.isArray(part?.coordinates)) return null;
    const coordinates = [];
    for (const value of part.coordinates) {
      const coordinate = normalizeCoordinate(value);
      if (!coordinate) return null;
      const result = unprojectLatLng(
        applyVector(projectCoordinate(coordinate, normalizedCenter)),
        normalizedCenter,
      );
      if (!result) return null;
      coordinates.push([result.lat, result.lng]);
    }
    transformed.push({ ...part, coordinates });
  }
  return transformed;
}

/** Choose one operation from the modifier snapshot captured on pointer-down. */
export function getZoneDragOperation({ zHeld, xHeld } = {}) {
  if (zHeld && xHeld) return null;
  if (zHeld) return 'rotate';
  if (xHeld) return 'scale';
  return 'move';
}

/** Exclude shortcuts while focus belongs to a form control or editable element. */
export function isEditableInteractionTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tagName = String(target.tagName ?? '').toLowerCase();
  return target.isContentEditable === true
    || ['input', 'textarea', 'select', 'option'].includes(tagName)
    || typeof target.closest === 'function' && !!target.closest('[contenteditable="true"]');
}

/** Accept a save response only while its drag still owns the same active selection. */
export function shouldApplyZoneCommit({
  enabled,
  interactionId,
  latestInteractionId,
  selectedZone,
  datasetId,
  featureId,
} = {}) {
  return enabled === true
    && interactionId === latestInteractionId
    && selectedZone?.datasetId === datasetId
    && selectedZone?.featureId === featureId;
}

/** Adapt a stored latitude/longitude tuple to the local projection input shape. */
function projectCoordinate([lat, lng], center) {
  return projectLatLng({ lat, lng }, center);
}

/** Project geographic input to local metre offsets around the shared zone centre. */
function projectLatLng(value, center) {
  const latitudeRadians = degreesToRadians(value.lat - center.lat);
  const longitudeRadians = degreesToRadians(wrapLongitude(value.lng - center.lng));
  const longitudeScale = Math.max(Math.cos(degreesToRadians(center.lat)), 0.000001);
  return {
    x: EARTH_RADIUS_METERS * longitudeRadians * longitudeScale,
    y: EARTH_RADIUS_METERS * latitudeRadians,
  };
}

/** Convert transformed local metre offsets back to validated geographic coordinates. */
function unprojectLatLng({ x, y }, center) {
  const longitudeScale = Math.max(Math.cos(degreesToRadians(center.lat)), 0.000001);
  const lat = center.lat + radiansToDegrees(y / EARTH_RADIUS_METERS);
  const lng = wrapLongitude(
    center.lng + radiansToDegrees(x / (EARTH_RADIUS_METERS * longitudeScale)),
  );
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

function normalizeCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = Number(value[0]);
  const lng = Number(value[1]);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? [lat, lng]
    : null;
}

function normalizeLatLng(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

function isClosedRing(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const first = normalizeCoordinate(coordinates[0]);
  const last = normalizeCoordinate(coordinates.at(-1));
  return !!first && !!last && first[0] === last[0] && first[1] === last[1];
}

function wrapLongitude(value) {
  return ((value + 540) % 360) - 180;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function radiansToDegrees(value) {
  return value * 180 / Math.PI;
}
