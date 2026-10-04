'use strict';
const { getGeojsonComponentStyle } = require('../src/data/geojsonFeatureModel.js');
const { getCoordinateBounds } = require('../src/data/geojsonStorage.js');

/** Materialize legacy lines in bounded keyset batches so compact and legacy inputs render alike. */
function rebuildSqliteDatasetLines({ db, datasetId }) {
  const read = db.prepare(`SELECT source_row_index, lat, lon, compact_json,
      timeline_start_year, timeline_end_year,
      TRIM(json_extract(compact_json, '$.featureId')) AS feature_id
    FROM features WHERE dataset_id = ? AND LOWER(TRIM(json_extract(compact_json, '$.featureType'))) = 'line'
      AND (TRIM(json_extract(compact_json, '$.featureId')), source_row_index) > (?, ?)
    ORDER BY TRIM(json_extract(compact_json, '$.featureId')), source_row_index LIMIT 1000`);
  const insert = db.prepare('INSERT INTO line_features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.prepare('DELETE FROM line_features WHERE dataset_id = ?').run(datasetId);
  let cursor = ['', -1];
  let current = null;
  while (true) {
    const batch = read.all(datasetId, ...cursor);
    if (!batch.length) break;
    for (const row of batch) {
      if (!row.feature_id) continue;
      if (current?.id !== row.feature_id) {
        if (current) write(current);
        current = { id: row.feature_id, rows: [] };
      }
      current.rows.push(row);
    }
    const last = batch.at(-1);
    cursor = [last.feature_id, last.source_row_index];
  }
  if (current) write(current);

  /** Sort only this line's vertices and retain first-valid style/arrow metadata. */
  function write(group) {
    if (group.rows.length < 2) return;
    const vertices = group.rows.map(row => ({ ...row, compact: JSON.parse(row.compact_json) }));
    const order = vertex => {
      const value = Number.parseFloat(vertex.compact.order);
      return Number.isFinite(value) ? value : Infinity;
    };
    vertices.sort((left, right) => order(left) - order(right) || left.source_row_index - right.source_row_index);
    const properties = {};
    for (const vertex of vertices) {
      for (const key of ['color', 'weight', 'opacity', 'arrow']) {
        if (properties[key] == null && String(vertex.compact[key] ?? '').trim()) properties[key] = vertex.compact[key];
      }
    }
    const coordinates = vertices.map(vertex => [vertex.lat, vertex.lon]);
    const bounds = getCoordinateBounds(coordinates);
    const first = vertices[0];
    const arrow = String(properties.arrow ?? 'none').toLowerCase();
    insert.run(datasetId, group.id, first.source_row_index, bounds.minLat, bounds.maxLat,
      bounds.minLon, bounds.maxLon, first.timeline_start_year, first.timeline_end_year,
      JSON.stringify(coordinates), JSON.stringify(getGeojsonComponentStyle(properties, 'line')),
      ['none', 'start', 'end', 'both'].includes(arrow) ? arrow : 'none');
  }
}

module.exports = { rebuildSqliteDatasetLines };
