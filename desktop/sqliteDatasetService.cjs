"use strict";

/**
 * Return dataset metadata and retained-row counts without loading row payloads.
 */
function getSqliteDatasetSummary({ db } = {}) {
  assertOpenDatabase(db);

  const rows = db.prepare(`
    SELECT
      id,
      file_name,
      row_count,
      (SELECT COUNT(*) FROM source_rows WHERE dataset_id = datasets.id) AS stored_row_count,
      imported_feature_count,
      skipped_row_count,
      columns_json,
      enabled,
      recommended_timeline_start_year,
      recommended_timeline_end_year,
      imported_at
    FROM datasets
    ORDER BY imported_at DESC, id ASC
  `).all();

  return {
    datasets: rows.map(toDatasetSummaryItem),
    timeline: null,
  };
}

/**
 * Persist visibility for one dataset without changing any other dataset.
 */
function setSqliteDatasetEnabled({ db, datasetId, enabled } = {}) {
  assertOpenDatabase(db);

  const normalizedDatasetId = normalizeDatasetId(datasetId);
  if (typeof enabled !== "boolean") {
    throw new TypeError("Dataset enabled state must be a boolean.");
  }

  const result = db.prepare(`
    UPDATE datasets
    SET enabled = ?
    WHERE id = ?
  `).run(enabled ? 1 : 0, normalizedDatasetId);

  return {
    updated: result.changes === 1,
  };
}

/**
 * Remove one dataset; source rows and derived features are deleted by cascade.
 */
function removeSqliteDataset({ db, datasetId } = {}) {
  assertOpenDatabase(db);

  const normalizedDatasetId = normalizeDatasetId(datasetId);
  const result = db.prepare(`
    DELETE FROM datasets
    WHERE id = ?
  `).run(normalizedDatasetId);

  return {
    removed: result.changes === 1,
  };
}

/** Report available rows separately from rows lost by legacy desktop imports. */
function toDatasetSummaryItem(row) {
  return {
    id: String(row.id),
    name: String(row.file_name),
    enabled: row.enabled === 1,
    headers: parseStringArray(row.columns_json),
    rowCount: normalizeCount(row.stored_row_count),
    totalRows: normalizeCount(row.stored_row_count),
    missingSourceRowCount: Math.max(0, normalizeCount(row.row_count) - normalizeCount(row.stored_row_count)),
    importedFeatureCount: normalizeCount(row.imported_feature_count),
    skippedRowCount: normalizeCount(row.skipped_row_count),
    recommendedTimelineRange: normalizeRecommendedTimelineRange(
      row.recommended_timeline_start_year,
      row.recommended_timeline_end_year,
    ),
    importedAt: String(row.imported_at),
  };
}

/** Read a bounded original-order page, retaining source identities across legacy gaps. */
function getSqlitePreviewPage({ db, datasetId, offset = 0, limit = 30 } = {}) {
  assertOpenDatabase(db);
  const id = normalizeDatasetId(datasetId);
  if (!Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("Preview offset and limit must be valid integers.");
  }
  const pageLimit = Math.min(limit, 200);
  // Metadata and rows share a read snapshot; no visibility or timeline filter applies.
  return db.transaction(() => {
    if (!db.prepare("SELECT id FROM datasets WHERE id = ?").get(id)) {
      throw new Error("The requested dataset is unavailable.");
    }
    const totalRows = db.prepare(
      "SELECT COUNT(*) AS count FROM source_rows WHERE dataset_id = ?",
    ).get(id).count;
    const stored = db.prepare(`
      SELECT source_row_index, row_json FROM source_rows
      WHERE dataset_id = ? ORDER BY source_row_index LIMIT ? OFFSET ?
    `).all(id, pageLimit, offset);
    return {
      datasetId: id,
      rows: stored.map((row) => JSON.parse(row.row_json)),
      sourceRowIndices: stored.map((row) => row.source_row_index),
      offset,
      limit: pageLimit,
      totalRows,
      hasMore: offset + stored.length < totalRows,
    };
  })();
}

/** Return a complete ordered recommendation, or an explicit null absence. */
function normalizeRecommendedTimelineRange(startValue, endValue) {
  if (startValue == null || endValue == null) return null;
  const startYear = Number(startValue);
  const endYear = Number(endValue);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  return {
    startYear: Math.min(Math.trunc(startYear), Math.trunc(endYear)),
    endYear: Math.max(Math.trunc(startYear), Math.trunc(endYear)),
  };
}

function parseStringArray(value) {
  if (!value || typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}

function normalizeCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

function normalizeDatasetId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("A dataset ID is required.");
  }

  return value.trim();
}

function assertOpenDatabase(db) {
  if (!db?.open) {
    throw new TypeError("An open SQLite database is required.");
  }
}

/** Seek bounded search batches or fetch matched identities without repeated counts or offsets. */
function getSqliteSearchRows({ db, ...query } = {}) {
  assertOpenDatabase(db);
  const datasetId = normalizeDatasetId(query.datasetId);
  const requested = query.rowIndices;
  const after = query.afterRowIndex ?? -1;
  if (!Number.isSafeInteger(after) || after < -1 || (requested != null && (
    !Array.isArray(requested) || requested.length < 1 || requested.length > 30
    || requested.some((index) => !Number.isSafeInteger(index) || index < 0)))) {
    throw new TypeError('Invalid search row request.');
  }

  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM datasets WHERE id = ?').get(datasetId)) {
      throw new Error('The requested dataset is unavailable.');
    }
    const stored = requested
      ? db.prepare(`SELECT source_row_index, row_json FROM source_rows
        WHERE dataset_id = ? AND source_row_index IN (${requested.map(() => '?').join(',')})
        ORDER BY source_row_index`).all(datasetId, ...requested)
      : db.prepare(`SELECT source_row_index, row_json FROM source_rows
        WHERE dataset_id = ? AND source_row_index > ? ORDER BY source_row_index LIMIT 201`).all(datasetId, after);
    // Read one extra identity instead of counting the full dataset for every batch.
    const page = stored.slice(0, 200);
    return { rows: page.map((row) => JSON.parse(row.row_json)),
      sourceRowIndices: page.map((row) => Number(row.source_row_index)), hasMore: stored.length > 200 };
  })();
}

module.exports = {
  getSqliteSearchRows,
  getSqlitePreviewPage,
  getSqliteDatasetSummary,
  removeSqliteDataset,
  setSqliteDatasetEnabled,
};
