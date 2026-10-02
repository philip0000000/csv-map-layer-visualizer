import { exactRowToPoint } from './browserSqlitePointQueries.js';
import { storedRowToGeometry } from './browserSqliteGeometryQueries.js';
import { detectFeatureTypeField, getRowFeatureType } from '../../components/featureTypes.js';
import { parseFlexibleFloat, isValidLat, isValidLon } from '../../components/geoColumns.js';

/** Resolve one source row without viewport limits or grouping, using existing derived geometry. */
export function getBrowserSqlitePreviewFeature(database, { sourceRef }) {
  const { datasetId, rowIndex } = sourceRef;
  const point = one(database, 'SELECT * FROM point_features WHERE dataset_id = ? AND source_row_index = ?', [datasetId, rowIndex]);
  if (point) return { points: [exactRowToPoint(point)] };
  const source = one(database, `SELECT s.row_json, d.columns_json, d.coordinate_mapping_json
    FROM source_rows s JOIN datasets d ON d.id = s.dataset_id
    WHERE s.dataset_id = ? AND s.source_row_index = ? AND d.import_state = 'complete'`, [datasetId, rowIndex]);
  if (!source) return {};
  const row = JSON.parse(source.row_json);
  const mapping = JSON.parse(source.coordinate_mapping_json);
  const type = getRowFeatureType(row, detectFeatureTypeField(JSON.parse(source.columns_json)));
  if (!['line', 'region'].includes(type)
    || !isValidLat(parseFlexibleFloat(row[mapping.latField]))
    || !isValidLon(parseFlexibleFloat(row[mapping.lonField]))) return {};
  // Any valid vertex resolves to its logical geometry's canonical metadata row.
  const geometry = one(database, `SELECT * FROM geometry_features
    WHERE dataset_id = ? AND geometry_type = ? AND feature_id = ? AND part = ?`,
  [datasetId, type, String(row.featureId ?? '').trim(), type === 'region' ? String(row.part ?? '').trim() || '0' : '']);
  if (!geometry) return {};
  const feature = storedRowToGeometry({ ...geometry, coordinate_mapping_json: source.coordinate_mapping_json });
  return feature ? { [type === 'line' ? 'lines' : 'regions']: [feature] } : {};
}

/** Read one structured record and always release the sql.js statement. */
function one(database, sql, params) {
  const statement = database.prepare(sql);
  try { statement.bind(params); return statement.step() ? statement.getAsObject() : null; }
  finally { statement.free(); }
}
