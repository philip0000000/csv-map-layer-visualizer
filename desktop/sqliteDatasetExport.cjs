"use strict";

const Papa = require("papaparse");

/** Reconstruct one desktop dataset from its current committed SQLite rows. */
function exportSqliteDatasetCsv({ db, datasetId } = {}) {
  requireOpenDatabase(db);
  const normalizedId = requireString(datasetId);
  const dataset = db.prepare(`
    SELECT file_name, columns_json
    FROM datasets
    WHERE id = ?
  `).get(normalizedId);

  if (!dataset) throw new Error("The requested dataset is unavailable.");

  const headers = parseHeaders(dataset.columns_json);
  const storedRows = db.prepare(`
    SELECT row_json
    FROM features
    WHERE dataset_id = ?
    ORDER BY source_row_index
  `).all(normalizedId);

  // Zone commits update the original coordinate keys in row_json. Header-driven
  // arrays therefore retain those coordinates and exclude every internal column.
  const rows = storedRows.map((stored) => {
    const row = parseStoredRow(stored.row_json);
    return headers.map((header) => row[header] ?? "");
  });

  return {
    datasetId: normalizedId,
    fileName: ensureCsvExtension(dataset.file_name),
    csvText: Papa.unparse({ fields: headers, data: rows }),
  };
}

/** Parse and validate the persisted import-time column ordering. */
function parseHeaders(value) {
  const headers = parseJson(value);
  if (
    !Array.isArray(headers)
    || headers.length === 0
    || !headers.every((header) => typeof header === "string" && header.length > 0)
  ) throw new Error("Stored CSV columns are unavailable.");
  return headers;
}

/** Parse one accepted source row without accepting internal or array-shaped data. */
function parseStoredRow(value) {
  const row = parseJson(value);
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Stored CSV row data is unavailable.");
  }
  return row;
}

/** Parse stored JSON and convert corruption into an export-level failure. */
function parseJson(value) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    throw new Error("Stored CSV data is unavailable.");
  }
}

/** Keep the imported display name while ensuring the Save As type is CSV. */
function ensureCsvExtension(value) {
  const fileName = requireString(value);
  return /\.csv$/i.test(fileName) ? fileName : `${fileName}.csv`;
}

/** Reject missing identifiers before preparing any dataset-specific query. */
function requireString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new TypeError("A dataset ID is required.");
}

/** Require the narrow better-sqlite3 surface used by this read-only service. */
function requireOpenDatabase(db) {
  if (!db?.open || typeof db.prepare !== "function") {
    throw new TypeError("An open SQLite database is required.");
  }
}

module.exports = { exportSqliteDatasetCsv };
