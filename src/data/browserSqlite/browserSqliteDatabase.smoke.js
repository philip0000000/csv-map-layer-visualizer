import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {
  BROWSER_SQLITE_SCHEMA_VERSION,
  closeBrowserSqliteDatabase,
  createBrowserSqliteDatabase,
  getBrowserSqliteSchemaVersion,
} from './browserSqliteDatabase.js';

const SQL = await initSqlJs();
let persistenceAccessCount = 0;
const restorePersistenceGuards = installPersistenceGuards(() => {
  persistenceAccessCount += 1;
});

try {
  const database = createBrowserSqliteDatabase(SQL);

  assert.equal(
    getBrowserSqliteSchemaVersion(database),
    BROWSER_SQLITE_SCHEMA_VERSION,
  );
  assert.equal(readScalar(database, 'PRAGMA foreign_keys'), 1);
  assert.deepEqual(readColumn(database, `
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `), ['datasets', 'geometry_features', 'point_features', 'source_rows']);
  assert.deepEqual(
    readColumn(database, 'PRAGMA table_info(datasets)', 'name'),
    [
      'id',
      'file_name',
      'size_bytes',
      'mime_type',
      'last_modified_ms',
      'columns_json',
      'total_parsed_row_count',
      'stored_row_count',
      'skipped_row_count',
      'point_feature_count',
      'skipped_point_count',
      'line_feature_count',
      'skipped_line_count',
      'region_feature_count',
      'skipped_region_count',
      'enabled',
      'detected_fields_json',
      'coordinate_mapping_json',
      'warnings_json',
      'import_state',
      'imported_at',
    ],
  );
  assert.deepEqual(
    readColumn(database, 'PRAGMA table_info(source_rows)', 'name'),
    ['dataset_id', 'source_row_index', 'row_json'],
  );
  assert.deepEqual(
    readColumn(database, 'PRAGMA table_info(point_features)', 'name'),
    [
      'dataset_id',
      'source_row_index',
      'lat',
      'lon',
      'timeline_start_year',
      'timeline_end_year',
      'compact_json',
    ],
  );
  assert.deepEqual(
    readColumn(database, 'PRAGMA table_info(geometry_features)', 'name'),
    [
      'dataset_id',
      'geometry_type',
      'feature_id',
      'part',
      'source_row_index',
      'feature_order_index',
      'part_order_index',
      'min_lat',
      'max_lat',
      'min_lon',
      'max_lon',
      'timeline_start_year',
      'timeline_end_year',
      'coordinates_json',
      'style_json',
      'arrow_mode',
    ],
  );
  assert.deepEqual(
    readColumn(database, 'PRAGMA index_list(datasets)', 'name'),
    ['idx_datasets_imported_order', 'sqlite_autoindex_datasets_1'],
  );
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM datasets'), 0);
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM source_rows'), 0);
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM point_features'), 0);
  assert.equal(readScalar(database, 'SELECT COUNT(*) FROM geometry_features'), 0);
  assert.equal(persistenceAccessCount, 0);
  assert.equal(closeBrowserSqliteDatabase(database), true);
  assert.equal(closeBrowserSqliteDatabase(database), false);

  const restartedDatabase = createBrowserSqliteDatabase(SQL);
  assert.equal(readScalar(restartedDatabase, 'SELECT COUNT(*) FROM datasets'), 0);
  assert.equal(
    readScalar(restartedDatabase, 'SELECT COUNT(*) FROM source_rows'),
    0,
  );
  closeBrowserSqliteDatabase(restartedDatabase);
} finally {
  restorePersistenceGuards();
}

console.log('Browser SQLite schema initialization smoke test passed.');

function readScalar(database, sql) {
  return database.exec(sql)?.[0]?.values?.[0]?.[0] ?? null;
}

function readColumn(database, sql, requestedColumn = null) {
  const result = database.exec(sql)?.[0];
  if (!result) return [];
  const columnIndex = requestedColumn == null
    ? 0
    : result.columns.indexOf(requestedColumn);
  return result.values.map((row) => row[columnIndex]);
}

function installPersistenceGuards(onAccess) {
  const propertyNames = ['indexedDB', 'localStorage', 'sessionStorage'];
  const originalDescriptors = new Map();

  for (const propertyName of propertyNames) {
    originalDescriptors.set(
      propertyName,
      Object.getOwnPropertyDescriptor(globalThis, propertyName),
    );
    Object.defineProperty(globalThis, propertyName, {
      configurable: true,
      get() {
        onAccess();
        throw new Error(`${propertyName} must not be used by the temporary database.`);
      },
    });
  }

  return () => {
    for (const [propertyName, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, propertyName, descriptor);
      } else {
        delete globalThis[propertyName];
      }
    }
  };
}
