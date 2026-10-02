'use strict';
const { rowToPointFeature } = require('./sqliteViewportQuery.cjs');

/** Resolve a retained source row to the same feature desktop map clicks select. */
function getSqlitePreviewFeature({ db, sourceRef } = {}) {
  if (typeof sourceRef?.datasetId !== 'string' || !Number.isSafeInteger(sourceRef.rowIndex) || sourceRef.rowIndex < 0) {
    throw new TypeError('A valid source-row reference is required.');
  }
  const row = db.prepare('SELECT * FROM features WHERE dataset_id = ? AND source_row_index = ?')
    .get(sourceRef.datasetId, sourceRef.rowIndex);
  if (!row) return {};
  const compact = JSON.parse(row.compact_json);
  if (String(compact.featureType ?? '').trim().toLowerCase() !== 'region') {
    // Preserve desktop's existing point rendering of non-region records.
    return { points: [rowToPointFeature(row)] };
  }
  const region = db.prepare('SELECT * FROM geometry_features WHERE dataset_id = ? AND feature_id = ? AND part = ?')
    .get(sourceRef.datasetId, String(compact.featureId ?? '').trim(), String(compact.part ?? '').trim() || '0');
  if (!region) return {};
  return { regions: [{
    id: `${region.dataset_id}:${region.feature_id}:${region.part}`,
    featureId: region.feature_id, part: region.part,
    coordinates: JSON.parse(region.coordinates_json), style: JSON.parse(region.style_json),
    timelineExtent: { startYear: region.timeline_start_year, endYear: region.timeline_end_year },
    sourceRef: { datasetId: region.dataset_id, rowIndex: region.source_row_index },
  }] };
}
module.exports = { getSqlitePreviewFeature };
