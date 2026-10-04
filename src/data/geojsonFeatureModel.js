import { classifyCsvGeometry, getGeojsonComponents } from './geojson.js';
import { autoDetectRangeFields, autoDetectTimelineFields, parseDateValue, parseYearValue } from '../components/timeline.js';
import { parseFlexibleFloat } from '../components/geoColumns.js';
import { getBrowserSqliteTimelineExtent } from './browserSqlite/browserSqliteTimeline.js';

/** Resolve compact CSV without interpreting unrelated custom geometry text as a shape. */
export function resolveEmbeddedGeojson(row, { native = false } = {}) {
  const interpretation = ['legacy', 'geojson'].includes(row.geometryInterpretation)
    ? row.geometryInterpretation : 'auto';
  const result = classifyCsvGeometry(row.geometry, interpretation);
  if (result.kind !== 'geojson') return result;
  if (!result.isFeature && typeof row.featureId === 'string' && row.featureId.trim()) {
    // Geometry-only CSV has no native Feature identity; preserve its established ID convention.
    result.feature.id = row.featureId.trim();
  }
  const properties = native ? { ...result.feature.properties } : { ...row };
  if (!native) {
    delete properties.geometry;
    delete properties.geometryInterpretation;
  }
  const supplied = result.feature.properties ?? {};
  for (const [key, value] of Object.entries(supplied)) {
    if (native || isRecognizedPropertyValid(key, value)) defineProperty(properties, key, value);
  }
  const components = getGeojsonComponents(result.feature);
  const kinds = new Set(components.map(component => component.kind));
  const csvType = native ? '' : String(row.featureType ?? '').trim().toLowerCase();
  if (csvType && [...kinds].some(kind => kind !== csvType)) {
    return { kind: 'invalid', warning: 'GeoJSON geometry conflicts with the CSV featureType.' };
  }
  return { ...result, properties, components, timeline: getFeatureTimeline(properties) };
}

/** Resolve existing timeline conventions using effective property keys, including nested CSV Features. */
export function getFeatureTimeline(properties) {
  const keys = Object.keys(properties);
  return getBrowserSqliteTimelineExtent(properties, {
    ...autoDetectTimelineFields(keys), ...autoDetectRangeFields(keys),
  });
}

/** Convert property values for table display and CSV export without coercing authoritative JSON. */
export function geojsonPropertyToCsv(value) {
  return value !== null && typeof value === 'object' ? JSON.stringify(value)
    : value == null ? '' : String(value);
}

/** Return compact styles appropriate for one component; keep geometry-specific options separate. */
export function getGeojsonComponentStyle(properties, kind) {
  const number = (key, minimum, maximum, fallback) => {
    const value = parseFlexibleFloat(properties[key]);
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
  };
  const color = nonblank(properties.color) ?? (kind === 'region' ? nonblank(properties.fillColor) : null) ?? '#3388ff';
  if (kind === 'point') {
    const image = nonblank(properties.image);
    return {
      marker: nonblank(properties.marker),
      image: image && !image.startsWith('/') && !/^https?:\/\//i.test(image) ? `/point-images/${image}` : image,
      imageWidthMeters: number('imageWidthMeters', 1, 100000, 100),
      imageHeightMeters: number('imageHeightMeters', 1, 100000, 100),
    };
  }
  return {
    color, weight: kind === 'line' ? Math.round(number('weight', 1, 20, 3)) : number('weight', 0, Infinity, 2),
    opacity: number('opacity', 0, 1, 1),
    ...(kind === 'region' ? {
      fillColor: nonblank(properties.fillColor) ?? color,
      fillOpacity: number('fillOpacity', 0, 1, 0.25),
    } : {}),
  };
}

/** Validate recognized overrides; arbitrary JSON properties always retain their source types. */
function isRecognizedPropertyValid(key, value) {
  if (['year', 'yearFrom', 'yearTo'].includes(key)) return parseYearValue(value) !== null;
  if (['date', 'dateFrom', 'dateTo'].includes(key)) return parseDateValue(value) !== null;
  if (['weight', 'opacity', 'fillOpacity', 'imageWidthMeters', 'imageHeightMeters', 'doy', 'dayOfYear'].includes(key)) {
    const number = parseFlexibleFloat(value);
    if (!Number.isFinite(number)) return false;
    if (['opacity', 'fillOpacity'].includes(key)) return number >= 0 && number <= 1;
    if (['imageWidthMeters', 'imageHeightMeters'].includes(key)) return number > 0;
    if (['doy', 'dayOfYear'].includes(key)) return Number.isInteger(number) && number >= 1 && number <= 366;
    return number >= 0;
  }
  if (key === 'arrow') return ['none', 'start', 'end', 'both'].includes(value);
  if (['color', 'fillColor', 'marker', 'image', 'name', 'title', 'label'].includes(key)) return nonblank(value) !== null;
  return true;
}

/** Avoid prototype setters when merging arbitrary imported property names. */
function defineProperty(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Normalize existing string fields without turning objects into misleading text. */
function nonblank(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
