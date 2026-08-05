"use strict";

/**
 * Return lightweight dataset metadata without reading feature rows into memory.
 */
function getSqliteDatasetSummary({ db } = {}) {
  assertOpenDatabase(db);

  const rows = db.prepare(`
    SELECT
      id,
      file_name,
      row_count,
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
 * Remove one stored dataset. Its features are deleted by the database cascade.
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

function toDatasetSummaryItem(row) {
  return {
    id: String(row.id),
    name: String(row.file_name),
    enabled: row.enabled === 1,
    headers: parseStringArray(row.columns_json),
    rowCount: normalizeCount(row.row_count),
    totalRows: normalizeCount(row.row_count),
    importedFeatureCount: normalizeCount(row.imported_feature_count),
    skippedRowCount: normalizeCount(row.skipped_row_count),
    recommendedTimelineRange: normalizeRecommendedTimelineRange(
      row.recommended_timeline_start_year,
      row.recommended_timeline_end_year,
    ),
    importedAt: String(row.imported_at),
  };
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

module.exports = {
  getSqliteDatasetSummary,
  removeSqliteDataset,
  setSqliteDatasetEnabled,
};
