"use strict";

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setImmediate: yieldControl } = require('node:timers/promises');
const { buildImportRows } = require('./csvImportService.cjs');
const { rebuildSqliteDatasetRegions } = require('./sqliteZoneService.cjs');
const { rebuildSqliteDatasetLines } = require('./sqliteLineService.cjs');
const { createSqliteAdapter } = require('./sqliteAdapter.cjs');
const { readImportTextChunks } = require('../src/data/importTextStream.js');
const { readCsvTextChunks } = require('../src/data/csvTextStream.js');
const { readGeojsonFeatures } = require('../src/data/geojsonStream.js');
const { normalizeGeojsonFeature, GeojsonValidationError, validateGeojsonDocumentMetadata } = require('../src/data/geojson.js');
const { GeojsonDocumentError } = require('../src/data/geojsonStream.js');
const { resolveEmbeddedGeojson, geojsonPropertyToCsv, getFeatureTimeline } = require('../src/data/geojsonFeatureModel.js');
const { storeGeojsonFeature } = require('../src/data/geojsonStorage.js');
const { normalizeCsvHeaders, csvRowToObject, isCsvRowEmpty, collectCsvParserWarnings, pushCsvWarning, warnForExtraCsvCells } = require('../src/data/csvParsingCompatibility.js');
const { autoDetectLatLon } = require('../src/components/geoColumns.js');
const { autoDetectTimelineFields, autoDetectRangeFields } = require('../src/components/timeline.js');
const { getImportFileFormat } = require('../src/data/importFileFormats.js');
const { getImportErrorMessage } = require('../src/data/importErrors.js');

/** Import supported local documents sequentially, with independent file transactions and cancellation. */
async function importMapFilesToSqlite({ db, filePaths, onProgress = () => {}, shouldCancel = () => false }) {
  if (!db?.open || !Array.isArray(filePaths)) throw new TypeError('An open database and file paths are required.');
  const results = [];
  let canceled = false;
  for (let index = 0; index < filePaths.length; index++) {
    if (shouldCancel()) { canceled = true; break; }
    const fileName = path.basename(filePaths[index]);
    const progress = event => {
      try { onProgress({ fileName, fileNumber: index + 1, totalFiles: filePaths.length, ...event }); }
      catch { /* Presentation callbacks must not change import atomicity. */ }
    };
    progress({ state: 'started' });
    try {
      const result = await importMapFile({ db, filePath: filePaths[index], progress, shouldCancel });
      results.push(result);
      progress({ state: 'completed', ok: true });
    } catch (error) {
      canceled = error.code === 'import-canceled';
      results.push({ ok: false, fileName, errorCode: error.code,
        error: getImportErrorMessage(error.code) ?? 'The file could not be imported.' });
      progress({ state: 'completed', ok: false });
      if (canceled) break;
    }
  }
  const successfulCount = results.filter(result => result.ok).length;
  return { ok: successfulCount > 0 && !canceled, canceled, successfulCount,
    failedCount: results.length - successfulCount, results };
}

/**
 * Incrementally read/decompress one document and commit only after EOF validation.
 * Legacy row batches reuse existing normalization; compact features retain one
 * source row and one authoritative Feature regardless of their vertex counts.
 */
async function importMapFile({ db, filePath, progress, shouldCancel }) {
  const format = getImportFileFormat(filePath);
  if (!format || !fs.statSync(filePath).isFile()) throw new TypeError('A supported file is required.');
  const datasetId = randomUUID();
  const adapter = createSqliteAdapter(db);
  const warnings = [];
  let headers = null;
  let rowCount = 0;
  let parsedCount = 0;
  let skipped = 0;
  let unmapped = 0;
  let featureCount = 0;
  let startYear = null;
  let endYear = null;
  let isFeatureCollection = false;
  const insertSource = db.prepare('INSERT INTO source_rows VALUES (?, ?, ?)');
  const insertFeature = db.prepare('INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const detect = () => ({ ...autoDetectLatLon(headers), ...autoDetectTimelineFields(headers), ...autoDetectRangeFields(headers) });
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO datasets(id, file_name, source_path, imported_at) VALUES (?, ?, ?, ?)`).run(
      datasetId, path.basename(filePath), filePath, new Date().toISOString());
    const text = (probe = false) => readImportTextChunks(fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }), {
      fileName: filePath, shouldCancel,
      onProgress: probe ? undefined : bytes => progress({ state: 'reading', ...bytes }),
    });
    if (format.format === 'geojson') {
      const keys = new Set(['geometry', 'geometryInterpretation']);
      headers = [...keys];
      for await (const value of readGeojsonFeatures(text, { shouldCancel,
        onCollectionStart: () => { isFeatureCollection = true; },
        onMetadata: metadata => {
          try { validateGeojsonDocumentMetadata(metadata); }
          catch (error) { throw new GeojsonDocumentError(error.message); }
          db.prepare('INSERT INTO geojson_documents(dataset_id, metadata_json) VALUES (?, ?)').run(datasetId, JSON.stringify(metadata));
        },
      })) {
        parsedCount++;
        try {
          if (isFeatureCollection && value?.type !== 'Feature') {
            throw new GeojsonValidationError('FeatureCollection entries must be Features.');
          }
          const feature = normalizeGeojsonFeature(value);
          const row = Object.fromEntries(Object.entries(feature.properties ?? {}).map(([key, property]) => [key, geojsonPropertyToCsv(property)]));
          row.geometry = JSON.stringify(feature);
          row.geometryInterpretation = 'geojson';
          delete row.featureType;
          Object.keys(row).forEach(key => keys.add(key));
          storeRow(row, feature);
        } catch (error) {
          if (!(error instanceof GeojsonValidationError)) throw error;
          skipped++;
          pushCsvWarning(warnings, `Skipped GeoJSON feature ${parsedCount}: ${error.message}`);
        }
        if (parsedCount % 500 === 0) {
          progress({ state: 'storing', completedRows: rowCount });
          await yieldControl();
        }
      }
      headers = [...keys];
    } else {
      for await (const result of readCsvTextChunks(text(), { shouldCancel })) {
        collectCsvParserWarnings(warnings, result.errors);
        for (const cells of result.data) {
          if (isCsvRowEmpty(cells)) continue;
          if (!headers) { headers = normalizeCsvHeaders(cells); continue; }
          parsedCount++;
          warnForExtraCsvCells(cells, headers, parsedCount + 1, warnings);
          const row = csvRowToObject(cells, headers);
          const compact = resolveEmbeddedGeojson(row);
          if (compact.kind === 'invalid') { skipped++; pushCsvWarning(warnings, `Skipped row ${parsedCount}: ${compact.warning}`); }
          else storeRow(row, compact.kind === 'geojson' ? compact.feature : null);
        }
        progress({ state: 'storing', completedRows: rowCount });
        await yieldControl();
      }
    }
    if (!headers?.length) throw new Error('The document has no usable header or features.');
    if (shouldCancel()) throw Object.assign(new Error('Import canceled.'), { code: 'import-canceled' });
    rebuildSqliteDatasetRegions({ db, datasetId });
    rebuildSqliteDatasetLines({ db, datasetId });
    // Count renderable logical geometries rather than legacy source vertices.
    featureCount = db.prepare(`SELECT
      (SELECT COUNT(*) FROM features WHERE dataset_id = ? AND
        COALESCE(LOWER(TRIM(json_extract(compact_json, '$.featureType'))), 'point') NOT IN ('line', 'region')) +
      (SELECT COUNT(*) FROM geometry_features WHERE dataset_id = ?) +
      (SELECT COUNT(*) FROM line_features WHERE dataset_id = ?) +
      (SELECT COUNT(*) FROM geojson_components WHERE dataset_id = ?) AS count`)
      .get(datasetId, datasetId, datasetId, datasetId).count;
    db.prepare(`UPDATE datasets SET row_count = ?, imported_feature_count = ?, skipped_row_count = ?, columns_json = ?,
      recommended_timeline_start_year = ?, recommended_timeline_end_year = ? WHERE id = ?`).run(
      rowCount, featureCount, unmapped + skipped, JSON.stringify(headers), startYear, endYear, datasetId);
    // Let a cancellation queued during geometry derivation roll back before commit.
    progress({ state: 'storing', completedRows: rowCount });
    await yieldControl();
    if (shouldCancel()) throw Object.assign(new Error('Import canceled.'), { code: 'import-canceled' });
    db.exec('COMMIT');
    return { ok: true, datasetId, fileName: path.basename(filePath), rowCount, importedFeatureCount: featureCount,
      skippedRowCount: skipped, unmappedRowCount: unmapped, detectedFields: detect(), parseErrors: warnings };
  } catch (error) { db.exec('ROLLBACK'); throw error; }

  /** Retain one source row and derive its compact records without a complete imported array. */
  function storeRow(row, feature) {
    const rowIndex = rowCount++;
    insertSource.run(datasetId, rowIndex, JSON.stringify(row));
    let extent;
    if (feature) {
      const resolved = resolveEmbeddedGeojson(row, { native: format.format === 'geojson' });
      storeGeojsonFeature(adapter, datasetId, rowIndex, feature, resolved.properties);
      featureCount += resolved.components.length;
      extent = resolved.timeline;
    } else {
      const fields = detect();
      const built = buildImportRows({ datasetId, rows: [row], detectedFields: fields });
      unmapped += built.skippedRowCount;
      for (const record of built.features) insertFeature.run(`${datasetId}:${rowIndex}`, datasetId, rowIndex,
        record.lat, record.lon, record.timelineStartYear, record.timelineEndYear, record.compactJson, record.rowJson);
      featureCount += built.features.length;
      extent = getFeatureTimeline(row);
    }
    if (extent) {
      startYear = startYear === null ? extent.startYear : Math.min(startYear, extent.startYear);
      endYear = endYear === null ? extent.endYear : Math.max(endYear, extent.endYear);
    }
  }
}

module.exports = { importMapFilesToSqlite };
