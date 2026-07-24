import initSqlJs from "sql.js/dist/sql-wasm-browser.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

const DEFAULT_SAMPLE_ROW_COUNT = 30_000;
const MAX_SAMPLE_ROW_COUNT = 50_000;
const DEFAULT_VIEWPORT_LIMIT = 25;
const MAX_VIEWPORT_LIMIT = 1_000;
const PROTOTYPE_DATASET_ID = "prototype-dataset";

let SQL = null;
let database = null;

self.addEventListener("message", (event) => {
  void handleRequest(event.data);
});

async function handleRequest(message) {
  const requestId = message?.requestId;
  const operation = message?.operation;

  if (!requestId || typeof operation !== "string") {
    postFailure(requestId, "invalid-request", "A request ID and named operation are required.");
    return;
  }

  postProgress(requestId, `${operation}:started`);

  try {
    let result;

    switch (operation) {
      case "initialize":
        result = await initializeDatabase(requestId);
        break;
      case "seed-sample-data":
        result = seedSampleData(message.payload);
        break;
      case "get-summary":
        result = getSummary();
        break;
      case "query-viewport":
        result = queryViewport(message.payload);
        break;
      case "get-feature-detail":
        result = getFeatureDetail(message.payload);
        break;
      case "close":
        result = closeDatabase();
        break;
      default:
        throw new PrototypeError(
          "unsupported-operation",
          `Unsupported worker operation: ${operation}`,
        );
    }

    self.postMessage({
      type: "response",
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    postFailure(
      requestId,
      error?.code ?? "prototype-operation-failed",
      error?.message ? String(error.message) : String(error),
    );
  }
}

async function initializeDatabase(requestId) {
  if (database) {
    return getInitializationResult(0, true);
  }

  const startedAt = performance.now();
  SQL ??= await initSqlJs({
    locateFile: () => sqlWasmUrl,
  });
  postProgress(requestId, "initialize:sqlite-module-ready");

  // No database bytes are supplied, so every worker starts with a fresh in-memory database.
  database = new SQL.Database();
  postProgress(requestId, "initialize:database-created");
  createSchema(database);
  postProgress(requestId, "initialize:schema-created");

  return getInitializationResult(elapsedMilliseconds(startedAt), false);
}

function createSchema(targetDatabase) {
  targetDatabase.run("PRAGMA foreign_keys = ON");
  targetDatabase.run(`
    CREATE TABLE datasets (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      source_path TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_feature_count INTEGER NOT NULL DEFAULT 0,
      skipped_row_count INTEGER NOT NULL DEFAULT 0,
      columns_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      imported_at TEXT NOT NULL
    );

    CREATE TABLE features (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      timeline_start_year INTEGER,
      timeline_end_year INTEGER,
      compact_json TEXT NOT NULL DEFAULT '{}',
      row_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_features_dataset
      ON features(dataset_id);

    CREATE INDEX idx_features_dataset_lat_lon
      ON features(dataset_id, lat, lon);

    CREATE INDEX idx_features_dataset_timeline
      ON features(dataset_id, timeline_start_year, timeline_end_year);

    CREATE UNIQUE INDEX idx_features_dataset_source_row
      ON features(dataset_id, source_row_index);
  `);
}

function seedSampleData(payload) {
  ensureDatabase();
  const rowCount = normalizeInteger(
    payload?.rowCount,
    DEFAULT_SAMPLE_ROW_COUNT,
    1,
    MAX_SAMPLE_ROW_COUNT,
  );
  const currentSummary = getSummary();

  if (currentSummary.featureCount !== 0 || currentSummary.datasetCount !== 0) {
    throw new PrototypeError(
      "database-not-empty",
      "Sample data can only be seeded into an empty prototype database.",
    );
  }

  const startedAt = performance.now();
  database.run("BEGIN TRANSACTION");
  let insertFeature = null;

  try {
    database.run(
      `INSERT INTO datasets (
        id, file_name, source_path, row_count, imported_feature_count,
        skipped_row_count, columns_json, enabled, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        PROTOTYPE_DATASET_ID,
        "prototype-30000.csv",
        null,
        rowCount,
        rowCount,
        0,
        JSON.stringify(["name", "latitude", "longitude", "year"]),
        1,
        "2026-01-01T00:00:00.000Z",
      ],
    );

    insertFeature = database.prepare(`
      INSERT INTO features (
        id, dataset_id, source_row_index, lat, lon,
        timeline_start_year, timeline_end_year, compact_json, row_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const point = createDeterministicPoint(rowIndex);
      insertFeature.run([
        `${PROTOTYPE_DATASET_ID}:${rowIndex}`,
        PROTOTYPE_DATASET_ID,
        rowIndex,
        point.lat,
        point.lon,
        point.year,
        point.year,
        JSON.stringify({
          marker: point.region,
          latField: "latitude",
          lonField: "longitude",
        }),
        JSON.stringify({
          name: `Prototype point ${rowIndex}`,
          latitude: point.lat.toFixed(6),
          longitude: point.lon.toFixed(6),
          year: String(point.year),
          region: point.region,
        }),
      ]);
    }

    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  } finally {
    insertFeature?.free();
  }

  return {
    datasetId: PROTOTYPE_DATASET_ID,
    insertedFeatureCount: rowCount,
    transactionUsed: true,
    durationMs: elapsedMilliseconds(startedAt),
  };
}

function getSummary() {
  ensureDatabase();
  const startedAt = performance.now();
  const row = getOne(`
    SELECT
      (SELECT COUNT(*) FROM datasets) AS dataset_count,
      (SELECT COUNT(*) FROM features) AS feature_count
  `);

  return {
    datasetCount: normalizeCount(row?.dataset_count),
    featureCount: normalizeCount(row?.feature_count),
    durationMs: elapsedMilliseconds(startedAt),
  };
}

function queryViewport(payload) {
  ensureDatabase();
  const bounds = normalizeBounds(payload?.bounds);
  const limit = normalizeInteger(
    payload?.limit,
    DEFAULT_VIEWPORT_LIMIT,
    1,
    MAX_VIEWPORT_LIMIT,
  );
  const startedAt = performance.now();
  const parameters = [bounds.south, bounds.north, bounds.west, bounds.east];
  const countRow = getOne(`
    SELECT COUNT(*) AS count
    FROM features
    WHERE dataset_id IN (SELECT id FROM datasets WHERE enabled = 1)
      AND lat BETWEEN ? AND ?
      AND lon BETWEEN ? AND ?
  `, parameters);
  const rows = getAll(`
    SELECT id, dataset_id, source_row_index, lat, lon,
      timeline_start_year, timeline_end_year, compact_json
    FROM features
    WHERE dataset_id IN (SELECT id FROM datasets WHERE enabled = 1)
      AND lat BETWEEN ? AND ?
      AND lon BETWEEN ? AND ?
    ORDER BY dataset_id, source_row_index
    LIMIT ?
  `, [...parameters, limit]);

  return {
    bounds,
    totalMatchingCount: normalizeCount(countRow?.count),
    returnedCount: rows.length,
    sampleRows: rows.slice(0, 3).map((row) => ({
      id: String(row.id),
      datasetId: String(row.dataset_id),
      sourceRowIndex: normalizeCount(row.source_row_index),
      lat: Number(row.lat),
      lon: Number(row.lon),
    })),
    durationMs: elapsedMilliseconds(startedAt),
  };
}

function getFeatureDetail(payload) {
  ensureDatabase();
  const datasetId = String(payload?.datasetId ?? "").trim();
  const sourceRowIndex = normalizeInteger(payload?.sourceRowIndex, -1, 0, Number.MAX_SAFE_INTEGER);

  if (!datasetId || sourceRowIndex < 0) {
    throw new PrototypeError(
      "invalid-detail-reference",
      "A dataset ID and non-negative source row index are required.",
    );
  }

  const startedAt = performance.now();
  const row = getOne(`
    SELECT id, dataset_id, source_row_index, lat, lon, row_json
    FROM features
    WHERE dataset_id = ? AND source_row_index = ?
  `, [datasetId, sourceRowIndex]);

  return {
    found: Boolean(row),
    feature: row ? {
      id: String(row.id),
      datasetId: String(row.dataset_id),
      sourceRowIndex: normalizeCount(row.source_row_index),
      lat: Number(row.lat),
      lon: Number(row.lon),
      fields: parseJsonObject(row.row_json),
    } : null,
    durationMs: elapsedMilliseconds(startedAt),
  };
}

function closeDatabase() {
  const wasOpen = Boolean(database);
  database?.close();
  database = null;

  return { closed: wasOpen };
}

function getInitializationResult(durationMs, reused) {
  return {
    sqliteVersion: getOne("SELECT sqlite_version() AS version")?.version ?? null,
    databaseStorage: "memory",
    workerType: "dedicated-module-worker",
    crossOriginIsolated: self.crossOriginIsolated === true,
    sharedArrayBufferRequired: false,
    reused,
    durationMs,
  };
}

function getOne(sql, parameters = []) {
  return getAll(sql, parameters, 1)[0] ?? null;
}

function getAll(sql, parameters = [], maximumRows = Number.POSITIVE_INFINITY) {
  const statement = database.prepare(sql);
  const rows = [];

  try {
    statement.bind(parameters);
    while (rows.length < maximumRows && statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }

  return rows;
}

function createDeterministicPoint(rowIndex) {
  const clusterIndex = Math.floor(rowIndex / 10_000) % 3;
  const position = rowIndex % 10_000;
  const row = position % 100;
  const column = Math.floor(position / 100);
  const regions = [
    { name: "stockholm", lat: 59.3, lon: 18.0 },
    { name: "western-europe", lat: 40.0, lon: -10.0 },
    { name: "sydney", lat: -33.9, lon: 151.15 },
  ];
  const region = regions[clusterIndex];

  return {
    lat: region.lat + row * 0.001,
    lon: region.lon + column * 0.001,
    year: 1900 + (rowIndex % 125),
    region: region.name,
  };
}

function normalizeBounds(bounds) {
  const north = Number(bounds?.north);
  const south = Number(bounds?.south);
  const east = Number(bounds?.east);
  const west = Number(bounds?.west);

  if (![north, south, east, west].every(Number.isFinite)) {
    throw new PrototypeError("invalid-bounds", "Finite viewport bounds are required.");
  }

  return {
    north: Math.max(-90, Math.min(90, Math.max(north, south))),
    south: Math.max(-90, Math.min(90, Math.min(north, south))),
    east: Math.max(-180, Math.min(180, east)),
    west: Math.max(-180, Math.min(180, west)),
  };
}

function normalizeInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function elapsedMilliseconds(startedAt) {
  return Number((performance.now() - startedAt).toFixed(2));
}

function ensureDatabase() {
  if (!database) {
    throw new PrototypeError(
      "database-not-initialized",
      "Initialize the prototype database before running this operation.",
    );
  }
}

function postProgress(requestId, stage) {
  self.postMessage({
    type: "progress",
    requestId,
    stage,
  });
}

function postFailure(requestId, code, message) {
  self.postMessage({
    type: "response",
    requestId,
    ok: false,
    error: {
      code,
      message,
    },
  });
}

class PrototypeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrototypeError";
    this.code = code;
  }
}
