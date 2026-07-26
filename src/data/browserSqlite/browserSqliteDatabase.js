/**
 * Schema version for the temporary browser SQLite database.
 *
 * The version describes databases created during the current page session. It
 * does not imply that database bytes are persisted or migrated across sessions.
 */
export const BROWSER_SQLITE_SCHEMA_VERSION = 1;

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
 * Initialize schema version 1 on a fresh in-memory database.
 *
 * Foreign keys are enabled before the schema transaction so dataset deletion
 * can safely cascade to original source rows. The composite source-row primary
 * key preserves deterministic row order without a separate imported array.
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
        enabled INTEGER NOT NULL DEFAULT 1
          CHECK (enabled IN (0, 1)),
        detected_fields_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(detected_fields_json)),
        coordinate_mapping_json TEXT NOT NULL
          DEFAULT '{"latField":null,"lonField":null}'
          CHECK (json_valid(coordinate_mapping_json)),
        warnings_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(warnings_json)),
        import_state TEXT NOT NULL DEFAULT 'importing'
          CHECK (import_state IN ('importing', 'complete')),
        imported_at TEXT,
        CHECK (
          stored_row_count + skipped_row_count = total_parsed_row_count
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

      CREATE INDEX idx_datasets_imported_order
        ON datasets(imported_at DESC, id);

      PRAGMA user_version = 1;
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
