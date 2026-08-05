/**
 * Schema version for the temporary browser SQLite database.
 *
 * The version describes databases created during the current page session. It
 * does not imply that database bytes are persisted or migrated across sessions.
 */
export const BROWSER_SQLITE_SCHEMA_VERSION = 3;

const closedDatabases = new WeakSet();

/**
 * Create a fresh in-memory SQLite database and initialize the browser schema.
 *
 * No database bytes or persistence configuration are supplied, so ownership
 * and lifetime remain entirely with the caller (normally the database worker).
 *
 * @param {{ Database: new () => object }} SQL Initialized sql.js module.
 * @returns {object} Initialized in-memory sql.js database.
 */
export function createBrowserSqliteDatabase(SQL) {
  if (!SQL || typeof SQL.Database !== 'function') {
    throw new TypeError('An initialized sql.js module is required.');
  }

  const database = new SQL.Database();

  try {
    initializeBrowserSqliteSchema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Initialize the current browser schema on a fresh in-memory database.
 *
 * Foreign keys are enabled before the schema transaction so dataset deletion
 * can safely cascade to original source rows. The composite source-row primary
 * key preserves deterministic row order without a separate imported array.
 * Compact geometry rows store only render data, source references, timeline
 * extents, and indexed bounding boxes; complete rows remain in `source_rows`.
 *
 * @param {{ run: (sql: string) => void }} database Fresh sql.js database.
 */
export function initializeBrowserSqliteSchema(database) {
  requireDatabaseMethod(database, 'run');
  database.run('PRAGMA foreign_keys = ON');
  database.run('BEGIN TRANSACTION');

  try {
    database.run(`
      CREATE TABLE datasets (
        id TEXT PRIMARY KEY
          CHECK (length(trim(id)) > 0),
        file_name TEXT NOT NULL
          CHECK (length(trim(file_name)) > 0),
        size_bytes INTEGER
          CHECK (size_bytes IS NULL OR size_bytes >= 0),
        mime_type TEXT,
        last_modified_ms INTEGER
          CHECK (last_modified_ms IS NULL OR last_modified_ms >= 0),
        columns_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(columns_json)),
        total_parsed_row_count INTEGER NOT NULL DEFAULT 0
          CHECK (total_parsed_row_count >= 0),
        stored_row_count INTEGER NOT NULL DEFAULT 0
          CHECK (stored_row_count >= 0),
        skipped_row_count INTEGER NOT NULL DEFAULT 0
          CHECK (skipped_row_count >= 0),
        point_feature_count INTEGER NOT NULL DEFAULT 0
          CHECK (point_feature_count >= 0),
        skipped_point_count INTEGER NOT NULL DEFAULT 0
          CHECK (skipped_point_count >= 0),
        line_feature_count INTEGER NOT NULL DEFAULT 0
          CHECK (line_feature_count >= 0),
        skipped_line_count INTEGER NOT NULL DEFAULT 0
          CHECK (skipped_line_count >= 0),
        region_feature_count INTEGER NOT NULL DEFAULT 0
          CHECK (region_feature_count >= 0),
        skipped_region_count INTEGER NOT NULL DEFAULT 0
          CHECK (skipped_region_count >= 0),
        enabled INTEGER NOT NULL DEFAULT 1
          CHECK (enabled IN (0, 1)),
        detected_fields_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(detected_fields_json)),
        coordinate_mapping_json TEXT NOT NULL
          DEFAULT '{"latField":null,"lonField":null}'
          CHECK (json_valid(coordinate_mapping_json)),
        recommended_timeline_start_year INTEGER,
        recommended_timeline_end_year INTEGER,
        warnings_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(warnings_json)),
        import_state TEXT NOT NULL DEFAULT 'importing'
          CHECK (import_state IN ('importing', 'complete')),
        imported_at TEXT,
        CHECK (
          stored_row_count + skipped_row_count = total_parsed_row_count
        ),
        CHECK (
          (recommended_timeline_start_year IS NULL AND recommended_timeline_end_year IS NULL)
          OR (
            recommended_timeline_start_year IS NOT NULL
            AND recommended_timeline_end_year IS NOT NULL
            AND recommended_timeline_start_year <= recommended_timeline_end_year
          )
        ),
        CHECK (
          (import_state = 'importing' AND imported_at IS NULL)
          OR
          (import_state = 'complete' AND imported_at IS NOT NULL)
        )
      );

      CREATE TABLE source_rows (
        dataset_id TEXT NOT NULL,
        source_row_index INTEGER NOT NULL
          CHECK (source_row_index >= 0),
        row_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(row_json)),
        PRIMARY KEY (dataset_id, source_row_index),
        FOREIGN KEY (dataset_id)
          REFERENCES datasets(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;

      CREATE TABLE point_features (
        dataset_id TEXT NOT NULL,
        source_row_index INTEGER NOT NULL
          CHECK (source_row_index >= 0),
        lat REAL NOT NULL
          CHECK (lat >= -90 AND lat <= 90),
        lon REAL NOT NULL
          CHECK (lon >= -180 AND lon <= 180),
        timeline_start_year INTEGER,
        timeline_end_year INTEGER,
        compact_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(compact_json)),
        PRIMARY KEY (dataset_id, source_row_index),
        FOREIGN KEY (dataset_id, source_row_index)
          REFERENCES source_rows(dataset_id, source_row_index)
          ON DELETE CASCADE,
        CHECK (
          (timeline_start_year IS NULL AND timeline_end_year IS NULL)
          OR
          (
            timeline_start_year IS NOT NULL
            AND timeline_end_year IS NOT NULL
            AND timeline_start_year <= timeline_end_year
          )
        )
      ) WITHOUT ROWID;

      CREATE TABLE geometry_features (
        dataset_id TEXT NOT NULL,
        geometry_type TEXT NOT NULL
          CHECK (geometry_type IN ('line', 'region')),
        feature_id TEXT NOT NULL
          CHECK (length(trim(feature_id)) > 0),
        part TEXT NOT NULL DEFAULT '',
        source_row_index INTEGER NOT NULL
          CHECK (source_row_index >= 0),
        feature_order_index INTEGER NOT NULL
          CHECK (feature_order_index >= 0),
        part_order_index INTEGER NOT NULL
          CHECK (part_order_index >= 0),
        min_lat REAL NOT NULL
          CHECK (min_lat >= -90 AND min_lat <= 90),
        max_lat REAL NOT NULL
          CHECK (max_lat >= -90 AND max_lat <= 90),
        min_lon REAL NOT NULL
          CHECK (min_lon >= -180 AND min_lon <= 180),
        max_lon REAL NOT NULL
          CHECK (max_lon >= -180 AND max_lon <= 180),
        timeline_start_year INTEGER,
        timeline_end_year INTEGER,
        coordinates_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(coordinates_json)),
        style_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(style_json)),
        arrow_mode TEXT
          CHECK (
            arrow_mode IS NULL
            OR arrow_mode IN ('none', 'start', 'end', 'both')
          ),
        PRIMARY KEY (dataset_id, geometry_type, feature_id, part),
        FOREIGN KEY (dataset_id, source_row_index)
          REFERENCES source_rows(dataset_id, source_row_index)
          ON DELETE CASCADE,
        CHECK (min_lat <= max_lat),
        CHECK (min_lon <= max_lon),
        CHECK (
          (geometry_type = 'line' AND part = '' AND arrow_mode IS NOT NULL)
          OR
          (geometry_type = 'region' AND arrow_mode IS NULL)
        ),
        CHECK (
          (timeline_start_year IS NULL AND timeline_end_year IS NULL)
          OR
          (
            timeline_start_year IS NOT NULL
            AND timeline_end_year IS NOT NULL
            AND timeline_start_year <= timeline_end_year
          )
        )
      ) WITHOUT ROWID;

      CREATE INDEX idx_datasets_imported_order
        ON datasets(imported_at DESC, id);

      CREATE INDEX idx_point_features_dataset_lat_lon
        ON point_features(dataset_id, lat, lon);

      CREATE INDEX idx_point_features_dataset_timeline
        ON point_features(
          dataset_id,
          timeline_start_year,
          timeline_end_year
        );

      CREATE INDEX idx_geometry_features_dataset_bounds
        ON geometry_features(
          dataset_id,
          geometry_type,
          min_lat,
          max_lat,
          min_lon,
          max_lon
        );

      CREATE INDEX idx_geometry_features_dataset_timeline
        ON geometry_features(
          dataset_id,
          timeline_start_year,
          timeline_end_year
        );

      PRAGMA user_version = 3;
    `);
    database.run('COMMIT');
  } catch (error) {
    try {
      database.run('ROLLBACK');
    } catch {
      // Preserve the schema initialization failure if SQLite already rolled back.
    }
    throw error;
  }
}

/**
 * Read the explicit schema version from an initialized browser database.
 *
 * @param {{ exec: (sql: string) => Array<object> }} database sql.js database.
 * @returns {number} Non-negative SQLite user version.
 */
export function getBrowserSqliteSchemaVersion(database) {
  requireDatabaseMethod(database, 'exec');
  const result = database.exec('PRAGMA user_version');
  const value = result?.[0]?.values?.[0]?.[0];
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

/**
 * Close a temporary browser database once.
 *
 * Repeated calls are harmless, which keeps worker disposal idempotent.
 *
 * @param {{ close: () => void }} database sql.js database.
 * @returns {boolean} True only when this call closed the database.
 */
export function closeBrowserSqliteDatabase(database) {
  requireDatabaseMethod(database, 'close');
  if (closedDatabases.has(database)) return false;
  database.close();
  closedDatabases.add(database);
  return true;
}

function requireDatabaseMethod(database, method) {
  if (!database || typeof database[method] !== 'function') {
    throw new TypeError(`A sql.js database with ${method}() is required.`);
  }
}
