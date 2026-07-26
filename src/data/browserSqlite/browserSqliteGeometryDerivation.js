import {
  isValidLat,
  isValidLon,
  parseFlexibleFloat,
} from '../../components/geoColumns.js';
import {
  detectFeatureTypeField,
  getRowFeatureType,
} from '../../components/featureTypes.js';
import {
  getBrowserSqliteTimelineExtent,
} from './browserSqliteTimeline.js';

const DEFAULT_LINE_STYLE = Object.freeze({ color: '#3388ff', weight: 3 });
const DEFAULT_REGION_STYLE = Object.freeze({
  color: '#3388ff',
  weight: 2,
  opacity: 1,
  fillColor: '#3388ff',
  fillOpacity: 0.25,
});
const ALLOWED_ARROW_MODES = new Set(['none', 'start', 'end', 'both']);
const MIN_LINE_WEIGHT = 1;
const MAX_LINE_WEIGHT = 20;
const STAGING_TABLE = 'browser_geometry_vertices';

/**
 * Rebuild compact line and region records from authoritative source rows.
 *
 * Valid vertices are staged in temporary SQLite storage, ordered there, and
 * consumed one geometry at a time. This preserves source/order semantics
 * without creating a second complete source-row array in worker memory. The
 * caller owns the surrounding transaction.
 *
 * @param {{ prepare: Function, run: Function }} database sql.js database.
 * @param {string} datasetId Stable dataset identifier.
 * @returns {object} Derived and skipped feature counts.
 */
export function rebuildBrowserSqliteGeometryFeatures(database, datasetId) {
  requireDatabase(database);
  const normalizedId = normalizeRequiredId(datasetId);
  const metadata = readDatasetMetadata(database, normalizedId);
  if (!metadata) {
    throw new BrowserSqliteGeometryDerivationError(
      'dataset-not-found',
      'The requested dataset is unavailable.',
    );
  }

  const headers = parseJsonStringList(metadata.columns_json);
  const mapping = parseJsonObject(metadata.coordinate_mapping_json);
  const detectedFields = parseJsonObject(metadata.detected_fields_json);
  const featureTypeField = detectFeatureTypeField(headers);
  const latField = normalizeNullableString(mapping.latField);
  const lonField = normalizeNullableString(mapping.lonField);
  const counts = {
    lineFeatureCount: 0,
    skippedLineCount: 0,
    regionFeatureCount: 0,
    skippedRegionCount: 0,
  };

  database.run(
    'DELETE FROM geometry_features WHERE dataset_id = ?',
    [normalizedId],
  );
  dropStagingTable(database);

  try {
    createStagingTable(database);
    if (latField && lonField && featureTypeField) {
      stageGeometryVertices(database, {
        datasetId: normalizedId,
        featureTypeField,
        latField,
        lonField,
        counts,
      });
      writeGeometryFeatures(database, {
        datasetId: normalizedId,
        detectedFields,
        counts,
      });
    }

    database.run(`
      UPDATE datasets
      SET line_feature_count = ?,
          skipped_line_count = ?,
          region_feature_count = ?,
          skipped_region_count = ?
      WHERE id = ?
    `, [
      counts.lineFeatureCount,
      counts.skippedLineCount,
      counts.regionFeatureCount,
      counts.skippedRegionCount,
      normalizedId,
    ]);
    return counts;
  } finally {
    dropStagingTable(database);
  }
}

/**
 * Store valid line and region vertices in temporary indexed worker storage.
 *
 * Invalid geometry never removes or changes the corresponding source row.
 * Missing identifiers and invalid coordinates increment the same skipped
 * counters as the current raw-browser derivation helpers.
 */
function stageGeometryVertices(database, {
  datasetId,
  featureTypeField,
  latField,
  lonField,
  counts,
}) {
  const sourceRows = database.prepare(`
    SELECT source_row_index, row_json
    FROM source_rows
    WHERE dataset_id = ?
    ORDER BY source_row_index
  `);
  let insertVertex = null;

  try {
    insertVertex = database.prepare(`
      INSERT INTO ${STAGING_TABLE} (
        geometry_type,
        feature_id,
        part,
        source_row_index,
        sort_order,
        lat,
        lon,
        color,
        weight,
        opacity,
        fill_color,
        fill_opacity,
        arrow_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    sourceRows.bind([datasetId]);

    while (sourceRows.step()) {
      const stored = sourceRows.getAsObject();
      const sourceRowIndex = normalizeSourceRowIndex(stored.source_row_index);
      const row = parseJsonObject(stored.row_json);
      const geometryType = getRowFeatureType(row, featureTypeField);
      if (geometryType !== 'line' && geometryType !== 'region') continue;

      const featureId = normalizeNullableString(row.featureId);
      const lat = parseFlexibleFloat(row[latField]);
      const lon = parseFlexibleFloat(row[lonField]);
      if (!featureId || !isValidLat(lat) || !isValidLon(lon)) {
        incrementSkipped(counts, geometryType);
        continue;
      }

      const order = parseOrderValue(row.order);
      insertVertex.run([
        geometryType,
        featureId,
        geometryType === 'region'
          ? normalizeNullableString(row.part) ?? '0'
          : '',
        sourceRowIndex,
        order ?? sourceRowIndex,
        lat,
        lon,
        compactString(row.color),
        compactString(row.weight),
        compactString(row.opacity),
        compactString(row.fillColor),
        compactString(row.fillOpacity),
        compactString(row.arrow),
      ]);
    }
  } finally {
    sourceRows.free();
    insertVertex?.free();
  }
}

/**
 * Resolve ordered staged vertices and insert one compact indexed geometry.
 *
 * Feature and part order use their first valid source rows. Vertex order uses
 * explicit numeric order when present and source order otherwise. Equal keys
 * fall back to source order, matching stable JavaScript sorting.
 */
function writeGeometryFeatures(database, context) {
  const vertices = database.prepare(`
    WITH ordered_vertices AS (
      SELECT
        *,
        MIN(source_row_index) OVER (
          PARTITION BY geometry_type, feature_id
        ) AS feature_order_index,
        MIN(source_row_index) OVER (
          PARTITION BY geometry_type, feature_id, part
        ) AS part_order_index
      FROM ${STAGING_TABLE}
    )
    SELECT *
    FROM ordered_vertices
    ORDER BY
      geometry_type,
      feature_order_index,
      part_order_index,
      sort_order,
      source_row_index
  `);
  const sourceRow = database.prepare(`
    SELECT row_json
    FROM source_rows
    WHERE dataset_id = ? AND source_row_index = ?
  `);
  const insertGeometry = database.prepare(`
    INSERT INTO geometry_features (
      dataset_id,
      geometry_type,
      feature_id,
      part,
      source_row_index,
      feature_order_index,
      part_order_index,
      min_lat,
      max_lat,
      min_lon,
      max_lon,
      timeline_start_year,
      timeline_end_year,
      coordinates_json,
      style_json,
      arrow_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let group = null;

  try {
    while (vertices.step()) {
      const vertex = vertices.getAsObject();
      const key = [
        vertex.geometry_type,
        vertex.feature_id,
        vertex.part,
      ].join('\u0000');

      if (group?.key !== key) {
        if (group) writeGeometryGroup(group, context, sourceRow, insertGeometry);
        group = createGeometryGroup(key, vertex);
      }
      addVertexToGroup(group, vertex);
    }
    if (group) writeGeometryGroup(group, context, sourceRow, insertGeometry);
  } finally {
    vertices.free();
    sourceRow.free();
    insertGeometry.free();
  }
}

function createGeometryGroup(key, vertex) {
  return {
    key,
    geometryType: String(vertex.geometry_type),
    featureId: String(vertex.feature_id),
    part: String(vertex.part),
    featureOrderIndex: normalizeSourceRowIndex(vertex.feature_order_index),
    partOrderIndex: normalizeSourceRowIndex(vertex.part_order_index),
    vertices: [],
  };
}

function addVertexToGroup(group, vertex) {
  group.vertices.push({
    sourceRowIndex: normalizeSourceRowIndex(vertex.source_row_index),
    lat: Number(vertex.lat),
    lon: Number(vertex.lon),
    color: vertex.color,
    weight: vertex.weight,
    opacity: vertex.opacity,
    fillColor: vertex.fill_color,
    fillOpacity: vertex.fill_opacity,
    arrow: vertex.arrow_mode,
  });
}

function writeGeometryGroup(group, context, sourceRow, insertGeometry) {
  const minimumVertices = group.geometryType === 'line' ? 2 : 3;
  if (group.vertices.length < minimumVertices) return;

  const coordinates = group.vertices.map(({ lat, lon }) => [lat, lon]);
  // Preserve already-closed rings and append exactly one closing coordinate
  // only when the resolved region vertices leave the ring open.
  if (group.geometryType === 'region' && !isRingClosed(coordinates)) {
    coordinates.push([...coordinates[0]]);
  }

  // Multipart regions intentionally share the first valid row of the logical
  // feature. Lines use their first resolved vertex, matching raw-browser detail
  // and timeline identity.
  const sourceRowIndex = group.geometryType === 'region'
    ? group.featureOrderIndex
    : group.vertices[0].sourceRowIndex;
  const detailRow = readSourceRow(
    sourceRow,
    context.datasetId,
    sourceRowIndex,
  );
  const timeline = getBrowserSqliteTimelineExtent(
    detailRow,
    context.detectedFields,
  );
  const bounds = getCoordinateBounds(coordinates);
  const style = group.geometryType === 'line'
    ? resolveLineStyle(group.vertices)
    : resolveRegionStyle(group.vertices);
  const arrow = group.geometryType === 'line'
    ? resolveArrowMode(group.vertices)
    : null;

  insertGeometry.run([
    context.datasetId,
    group.geometryType,
    group.featureId,
    group.part,
    sourceRowIndex,
    group.featureOrderIndex,
    group.partOrderIndex,
    bounds.minLat,
    bounds.maxLat,
    bounds.minLon,
    bounds.maxLon,
    timeline?.startYear ?? null,
    timeline?.endYear ?? null,
    JSON.stringify(coordinates),
    JSON.stringify(style),
    arrow,
  ]);

  if (group.geometryType === 'line') {
    context.counts.lineFeatureCount += 1;
  } else {
    context.counts.regionFeatureCount += 1;
  }
}

function readSourceRow(statement, datasetId, sourceRowIndex) {
  statement.reset();
  statement.bind([datasetId, sourceRowIndex]);
  return statement.step()
    ? parseJsonObject(statement.getAsObject().row_json)
    : {};
}

/** Resolve first-valid line style values without main-thread DOM APIs. */
function resolveLineStyle(vertices) {
  const style = {};
  for (const vertex of vertices) {
    applyFirstNonEmpty(style, 'color', vertex.color, parseWorkerColor);
    applyFirstNonEmpty(style, 'weight', vertex.weight, parseLineWeight);
  }
  return { ...DEFAULT_LINE_STYLE, ...style };
}

/** Resolve per-part region styles and the existing color/fill fallback. */
function resolveRegionStyle(vertices) {
  const style = {};
  for (const vertex of vertices) {
    applyFirstNonEmpty(style, 'color', vertex.color);
    applyFirstNonEmpty(style, 'weight', vertex.weight, parseNumber);
    applyFirstNonEmpty(style, 'opacity', vertex.opacity, parseNumber);
    applyFirstNonEmpty(style, 'fillColor', vertex.fillColor);
    applyFirstNonEmpty(style, 'fillOpacity', vertex.fillOpacity, parseNumber);
  }

  const hasColor = Object.hasOwn(style, 'color');
  const hasFillColor = Object.hasOwn(style, 'fillColor');
  const resolved = { ...DEFAULT_REGION_STYLE, ...style };
  if (!hasFillColor && resolved.color) resolved.fillColor = resolved.color;
  if (!hasColor && resolved.fillColor) resolved.color = resolved.fillColor;
  return resolved;
}

function resolveArrowMode(vertices) {
  for (const vertex of vertices) {
    const arrow = normalizeNullableString(vertex.arrow)?.toLowerCase();
    if (arrow && ALLOWED_ARROW_MODES.has(arrow)) return arrow;
  }
  return 'none';
}

function parseWorkerColor(value) {
  // CSS.supports is a main-thread API. The worker retains any non-empty color
  // string and lets the renderer apply it, matching the existing no-CSS path.
  return normalizeNullableString(value);
}

function parseLineWeight(value) {
  const number = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(number)) return null;
  return Math.min(
    MAX_LINE_WEIGHT,
    Math.max(MIN_LINE_WEIGHT, Math.round(number)),
  );
}

function parseNumber(value) {
  const number = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(number) ? number : null;
}

function parseOrderValue(value) {
  const number = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(number) ? number : null;
}

function applyFirstNonEmpty(target, key, value, parser) {
  if (target[key] != null && target[key] !== '') return;
  const raw = normalizeNullableString(value);
  if (!raw) return;
  const parsed = parser ? parser(raw) : raw;
  if (parsed != null && parsed !== '') target[key] = parsed;
}

function getCoordinateBounds(coordinates) {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const [lat, lon] of coordinates) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return { minLat, maxLat, minLon, maxLon };
}

function isRingClosed(coordinates) {
  if (coordinates.length === 0) return true;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  return first[0] === last[0] && first[1] === last[1];
}

function incrementSkipped(counts, geometryType) {
  if (geometryType === 'line') counts.skippedLineCount += 1;
  else counts.skippedRegionCount += 1;
}

function createStagingTable(database) {
  database.run(`
    CREATE TEMP TABLE ${STAGING_TABLE} (
      geometry_type TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      part TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      sort_order REAL NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      color TEXT,
      weight TEXT,
      opacity TEXT,
      fill_color TEXT,
      fill_opacity TEXT,
      arrow_mode TEXT
    )
  `);
}

function dropStagingTable(database) {
  database.run(`DROP TABLE IF EXISTS temp.${STAGING_TABLE}`);
}

function readDatasetMetadata(database, datasetId) {
  const statement = database.prepare(`
    SELECT columns_json, detected_fields_json, coordinate_mapping_json
    FROM datasets
    WHERE id = ?
  `);
  try {
    statement.bind([datasetId]);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonStringList(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalizeRequiredId(value) {
  const id = normalizeNullableString(value);
  if (id) return id;
  throw new BrowserSqliteGeometryDerivationError(
    'invalid-geometry-rebuild',
    'A dataset ID is required.',
  );
}

function normalizeSourceRowIndex(value) {
  const number = Number(value);
  if (Number.isSafeInteger(number) && number >= 0) return number;
  throw new BrowserSqliteGeometryDerivationError(
    'invalid-geometry-rebuild',
    'A stored source-row index is invalid.',
  );
}

function compactString(value) {
  if (value == null) return null;
  const string = String(value);
  return string === '' ? null : string;
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function requireDatabase(database) {
  if (
    !database ||
    typeof database.prepare !== 'function' ||
    typeof database.run !== 'function'
  ) {
    throw new TypeError(
      'A sql.js database with prepare() and run() is required.',
    );
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class BrowserSqliteGeometryDerivationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqliteGeometryDerivationError';
    this.code = code;
  }
}
