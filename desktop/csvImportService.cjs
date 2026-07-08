"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Papa = require("papaparse");

const LAT_SYNONYMS = ["lat", "latitude", "y", "northing"];
const LON_SYNONYMS = ["lon", "lng", "long", "longitude", "x", "easting"];
const YEAR_SYNONYMS = ["year", "yyyy", "yr", "ar"];
const DATE_SYNONYMS = ["date", "datetime", "timestamp", "time", "created", "createdat"];
// These fields are small enough to keep beside each imported point. Later map queries can read them without loading the full row.
const COMPACT_FIELD_NAMES = [
  "featureType",
  "featureId",
  "part",
  "order",
  "name",
  "title",
  "label",
  "comment",
  "marker",
  "image",
  "color",
  "weight",
];

/**
 * Import one local CSV file into the desktop SQLite store.
 * This does not update the Leaflet map. It only writes data for later query work.
 */
function importCsvFileToSqlite({ db, filePath }) {
  if (!db?.open) {
    throw new TypeError("An open SQLite database is required.");
  }

  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("A CSV file path is required.");
  }

  const csvText = fs.readFileSync(filePath, "utf8");
  const parsed = parseCsvText(csvText);
  const detectedFields = detectFields(parsed.headers);
  const datasetId = randomUUID();

  const importRows = buildImportRows({
    datasetId,
    rows: parsed.rows,
    detectedFields,
  });

  const summary = {
    ok: true,
    datasetId,
    fileName: path.basename(filePath),
    sourcePath: filePath,
    rowCount: parsed.rows.length,
    importedFeatureCount: importRows.features.length,
    skippedRowCount: importRows.skippedRowCount,
    columns: parsed.headers,
    detectedFields,
    parseErrors: parsed.parseErrors,
  };

  insertImportResult(db, summary, importRows.features);

  return summary;
}

/**
 * Parse CSV text into headers and row objects.
 * This mirrors the browser parser shape, but runs in Electron main process code.
 */
function parseCsvText(csvText) {
  const result = Papa.parse(csvText, {
    delimiter: "",
    skipEmptyLines: true,
    quoteChar: '"',
    escapeChar: '"',
  });

  const parseErrors = (result.errors ?? []).map(
    (error) => `Parser: ${error.message} (row ${error.row ?? "?"})`,
  );
  const data = Array.isArray(result.data) ? result.data : [];
  const firstNonEmptyRowIndex = data.findIndex((row) => Array.isArray(row) && !isEmptyRow(row));

  if (firstNonEmptyRowIndex < 0) {
    return { headers: [], rows: [], parseErrors: [...parseErrors, "No rows detected."] };
  }

  const headers = normalizeHeaders(data[firstNonEmptyRowIndex].map((value) => String(value ?? "")));
  if (headers.length === 0) {
    return { headers: [], rows: [], parseErrors: [...parseErrors, "Header row is empty."] };
  }

  const rows = [];
  for (const rowArr of data.slice(firstNonEmptyRowIndex + 1)) {
    if (!Array.isArray(rowArr) || isEmptyRow(rowArr)) continue;
    rows.push(rowArrayToObject(rowArr, headers));
  }

  return { headers, rows, parseErrors };
}

/**
 * Find useful columns by common names, such as latitude, longitude, year, and date.
 */
function detectFields(headers) {
  return {
    latField: pickBest(headers, LAT_SYNONYMS),
    lonField: pickBest(headers, LON_SYNONYMS),
    yearField: pickBest(headers, YEAR_SYNONYMS),
    dateField: pickBest(headers, DATE_SYNONYMS),
    yearFromField: findExactKey(headers, "yearfrom"),
    yearToField: findExactKey(headers, "yearto"),
    dateFromField: findExactKey(headers, "datefrom"),
    dateToField: findExactKey(headers, "dateto"),
  };
}

/**
 * Convert parsed CSV rows into rows that match the prototype SQLite schema.
 * Rows without valid coordinates are counted as skipped.
 */
function buildImportRows({ datasetId, rows, detectedFields }) {
  const features = [];
  let skippedRowCount = 0;

  const latField = detectedFields.latField;
  const lonField = detectedFields.lonField;

  if (!latField || !lonField) {
    return {
      features,
      skippedRowCount: rows.length,
    };
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const lat = parseFlexibleFloat(row?.[latField]);
    const lon = parseFlexibleFloat(row?.[lonField]);

    if (!isValidLat(lat) || !isValidLon(lon)) {
      skippedRowCount += 1;
      continue;
    }

    const timelineExtent = getRowTimelineExtent(row, detectedFields);
    const id = `${datasetId}:${rowIndex}`;

    features.push({
      id,
      datasetId,
      sourceRowIndex: rowIndex,
      lat,
      lon,
      timelineStartYear: timelineExtent?.startYear ?? null,
      timelineEndYear: timelineExtent?.endYear ?? null,
      compactJson: JSON.stringify(getCompactFields(row, detectedFields)),
      rowJson: JSON.stringify(row),
    });
  }

  return {
    features,
    skippedRowCount,
  };
}

/**
 * Store dataset metadata and feature rows in one transaction.
 * This keeps partial imports out of the database if an insert fails.
 */
function insertImportResult(db, summary, features) {
  const insertDataset = db.prepare(`
    INSERT INTO datasets (
      id,
      file_name,
      source_path,
      row_count,
      imported_feature_count,
      skipped_row_count,
      columns_json,
      imported_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFeature = db.prepare(`
    INSERT INTO features (
      id,
      dataset_id,
      source_row_index,
      lat,
      lon,
      timeline_start_year,
      timeline_end_year,
      compact_json,
      row_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runImport = db.transaction(() => {
    insertDataset.run(
      summary.datasetId,
      summary.fileName,
      summary.sourcePath,
      summary.rowCount,
      summary.importedFeatureCount,
      summary.skippedRowCount,
      JSON.stringify(summary.columns),
      new Date().toISOString(),
    );

    for (const feature of features) {
      insertFeature.run(
        feature.id,
        feature.datasetId,
        feature.sourceRowIndex,
        feature.lat,
        feature.lon,
        feature.timelineStartYear,
        feature.timelineEndYear,
        feature.compactJson,
        feature.rowJson,
      );
    }
  });

  runImport();
}

function normalizeHeaders(rawHeaders) {
  const seen = new Map();
  const headers = [];

  for (const rawHeader of rawHeaders) {
    const base = String(rawHeader ?? "").trim();
    if (!base) continue;

    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    headers.push(count === 1 ? base : `${base}_${count}`);
  }

  return headers;
}

function rowArrayToObject(rowArr, headers) {
  const row = {};

  for (let index = 0; index < headers.length; index += 1) {
    row[headers[index]] = String(rowArr[index] ?? "").trim();
  }

  return row;
}

function isEmptyRow(row) {
  return row.every((value) => String(value ?? "").trim() === "");
}

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "")
    .replace(/\d+$/g, "");
}

function pickBest(headers, synonyms) {
  let best = { field: null, score: 0 };

  for (const header of headers) {
    const normalized = normalizeKey(header);
    const score = scoreHeader(normalized, synonyms);
    if (score > best.score) best = { field: header, score };
  }

  return best.field;
}

function scoreHeader(normalized, synonyms) {
  for (const synonym of synonyms) {
    if (normalized === synonym) return 100;
  }

  for (const synonym of synonyms) {
    if (normalized.includes(synonym)) return 50;
  }

  return 0;
}

function findExactKey(headers, normalizedKey) {
  for (const header of headers) {
    if (normalizeKey(header) === normalizedKey) return header;
  }

  return null;
}

function parseFlexibleFloat(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;

  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, ".");

  if (!normalized) return NaN;

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isValidLat(lat) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLon(lon) {
  return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

function getRowTimelineExtent(row, fields) {
  const yearFrom = getRangeYear(row, fields.yearFromField, fields.dateFromField);
  const yearTo = getRangeYear(row, fields.yearToField, fields.dateToField);

  if (yearFrom != null || yearTo != null) {
    const startYear = yearFrom ?? yearTo;
    const endYear = yearTo ?? yearFrom;
    return { startYear, endYear };
  }

  const year = getRangeYear(row, fields.yearField, fields.dateField);
  if (year == null) return null;

  return { startYear: year, endYear: year };
}

function getRangeYear(row, yearField, dateField) {
  if (!row || typeof row !== "object") return null;

  if (yearField) {
    const year = parseYearValue(row[yearField]);
    if (year != null) return year;
  }

  if (dateField) {
    const date = parseDateValue(row[dateField]);
    if (date) return date.getUTCFullYear();
  }

  return null;
}

function parseYearValue(value) {
  if (value == null) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return isReasonableYear(year) ? year : null;
  }

  const match = String(value).trim().match(/-?\d{1,5}/);
  if (!match) return null;

  const year = Number.parseInt(match[0], 10);
  return isReasonableYear(year) ? year : null;
}

function parseDateValue(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^-?\d{1,5}$/.test(raw)) {
    const year = Number.parseInt(raw, 10);
    if (!isReasonableYear(year)) return null;

    const date = new Date(Date.UTC(year, 0, 1));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date;

  const match = raw.match(/^(-?\d{1,5})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isReasonableYear(year) {
  return Number.isFinite(year) && Math.abs(year) <= 10000;
}

function getCompactFields(row, detectedFields) {
  const compact = {
    latField: detectedFields.latField,
    lonField: detectedFields.lonField,
  };

  for (const key of COMPACT_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      compact[key] = row[key];
    }
  }

  return compact;
}

module.exports = {
  importCsvFileToSqlite,
};
