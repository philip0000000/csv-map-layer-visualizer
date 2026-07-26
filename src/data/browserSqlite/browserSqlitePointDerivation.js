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

const DEFAULT_IMAGE_SIZE_METERS = 100;
const MIN_IMAGE_SIZE_METERS = 1;
const MAX_IMAGE_SIZE_METERS = 100_000;
const COMPACT_FIELD_NAMES = Object.freeze([
  'featureType',
  'featureId',
  'part',
  'order',
  'name',
  'title',
  'label',
  'comment',
  'marker',
  'image',
  'color',
  'weight',
]);

/**
 * Rebuild one dataset's compact point records from its authoritative source rows.
 *
 * The caller owns the surrounding transaction. Source rows are stepped one at a
 * time so remapping does not create a second complete in-memory dataset.
 *
 * @param {{ prepare: Function, run: Function }} database sql.js database.
 * @param {string} datasetId Stable dataset identifier.
 * @returns {{ pointFeatureCount: number, skippedPointCount: number }}
 */
export function rebuildBrowserSqlitePointFeatures(database, datasetId) {
  requireDatabase(database);
  const normalizedId = normalizeRequiredId(datasetId);
  const metadata = readDatasetDerivationMetadata(database, normalizedId);
  if (!metadata) {
    throw new BrowserSqlitePointDerivationError(
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
  let pointFeatureCount = 0;
  let skippedPointCount = 0;

  database.run(
    'DELETE FROM point_features WHERE dataset_id = ?',
    [normalizedId],
  );

  if (latField && lonField) {
    const sourceRows = database.prepare(`
      SELECT source_row_index, row_json
      FROM source_rows
      WHERE dataset_id = ?
      ORDER BY source_row_index
    `);
    let insertPoint = null;

    try {
      insertPoint = database.prepare(`
        INSERT INTO point_features (
          dataset_id,
          source_row_index,
          lat,
          lon,
          timeline_start_year,
          timeline_end_year,
          compact_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      sourceRows.bind([normalizedId]);
      while (sourceRows.step()) {
        const stored = sourceRows.getAsObject();
        const row = parseJsonObject(stored.row_json);
        const featureType = getRowFeatureType(row, featureTypeField);

        // Explicit line, region, or unknown feature types are not point failures.
        if (featureType && featureType !== 'point') continue;

        const lat = parseFlexibleFloat(row[latField]);
        const lon = parseFlexibleFloat(row[lonField]);
        if (!isValidLat(lat) || !isValidLon(lon)) {
          skippedPointCount += 1;
          continue;
        }

        const timeline = getBrowserSqliteTimelineExtent(row, detectedFields);
        insertPoint.run([
          normalizedId,
          normalizeSourceRowIndex(stored.source_row_index),
          lat,
          lon,
          timeline?.startYear ?? null,
          timeline?.endYear ?? null,
          JSON.stringify(getCompactFields(row, { latField, lonField })),
        ]);
        pointFeatureCount += 1;
      }
    } finally {
      sourceRows.free();
      insertPoint?.free();
    }
  }

  database.run(`
    UPDATE datasets
    SET point_feature_count = ?,
        skipped_point_count = ?
    WHERE id = ?
  `, [pointFeatureCount, skippedPointCount, normalizedId]);

  return { pointFeatureCount, skippedPointCount };
}

function getCompactFields(row, mapping) {
  const compact = {
    latField: mapping.latField,
    lonField: mapping.lonField,
  };

  for (const key of COMPACT_FIELD_NAMES) {
    if (Object.hasOwn(row, key)) compact[key] = row[key];
  }

  compact.image = resolvePointImage(row.image);
  compact.imageWidthMeters = normalizeImageSizeMeters(row.imageWidthMeters);
  compact.imageHeightMeters = normalizeImageSizeMeters(row.imageHeightMeters);
  return compact;
}

function resolvePointImage(value) {
  if (typeof value !== 'string') return null;
  const image = value.trim();
  if (!image) return null;
  if (image.startsWith('/') || /^https?:\/\//i.test(image)) return image;
  return `/point-images/${image}`;
}

function normalizeImageSizeMeters(value) {
  const number = parseFlexibleFloat(value);
  if (!Number.isFinite(number)) return DEFAULT_IMAGE_SIZE_METERS;
  return Math.min(
    MAX_IMAGE_SIZE_METERS,
    Math.max(MIN_IMAGE_SIZE_METERS, number),
  );
}

function readDatasetDerivationMetadata(database, datasetId) {
  const statement = database.prepare(`
    SELECT
      columns_json,
      detected_fields_json,
      coordinate_mapping_json
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
  throw new BrowserSqlitePointDerivationError(
    'invalid-point-rebuild',
    'A dataset ID is required.',
  );
}

function normalizeSourceRowIndex(value) {
  const number = Number(value);
  if (Number.isSafeInteger(number) && number >= 0) return number;
  throw new BrowserSqlitePointDerivationError(
    'invalid-point-rebuild',
    'A stored source-row index is invalid.',
  );
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

export class BrowserSqlitePointDerivationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSqlitePointDerivationError';
    this.code = code;
  }
}
