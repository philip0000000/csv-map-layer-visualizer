"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { importCsvFilesToSqlite } = require("./csvImportService.cjs");
const { getImportFileFormat } = require('../src/data/importFileFormats.js');

const MAX_DROPPED_CSV_FILES = 100;

/**
 * Retain the synchronous CSV compatibility entry point used by existing callers/tests.
 * The application uses mapImportService for streaming imports of all supported formats.
 */
function importDroppedCsvFilesToSqlite({ db, filePaths, onProgress = null }) {
  if (!db?.open) {
    throw new TypeError("An open SQLite database is required.");
  }

  const { validFilePaths, invalidResults } = validateDroppedCsvFilePaths(filePaths);
  const imported = validFilePaths.length > 0
    ? importCsvFilesToSqlite({ db, filePaths: validFilePaths, onProgress })
    : createEmptyBatchResult();

  return {
    ...imported,
    failedCount: imported.failedCount + invalidResults.length,
    results: [...imported.results, ...invalidResults],
  };
}

function validateDroppedCsvFilePaths(filePaths) {
  const candidates = Array.isArray(filePaths) ? filePaths : [];
  const validFilePaths = [];
  const invalidResults = [];
  const seenPaths = new Set();

  candidates.slice(0, MAX_DROPPED_CSV_FILES).forEach((filePath) => {
    const fileName = getSafeFileName(filePath);
    if (typeof filePath !== "string" || !filePath.trim()) {
      invalidResults.push(createInvalidResult(fileName, "The dropped file is invalid."));
      return;
    }
    if (!getImportFileFormat(filePath)) {
      invalidResults.push(createInvalidResult(fileName, "Only CSV or GeoJSON files, optionally gzip compressed, can be imported."));
      return;
    }

    try {
      const realPath = fs.realpathSync(path.resolve(filePath));
      const stats = fs.statSync(realPath);
      if (!stats.isFile() || !getImportFileFormat(realPath)) {
        invalidResults.push(createInvalidResult(fileName, "The dropped item is not a supported dataset file."));
        return;
      }

      const comparisonPath = process.platform === "win32"
        ? realPath.toLowerCase()
        : realPath;
      if (seenPaths.has(comparisonPath)) return;

      seenPaths.add(comparisonPath);
      validFilePaths.push(realPath);
    } catch {
      invalidResults.push(createInvalidResult(fileName, "The dataset file could not be found or read."));
    }
  });

  candidates.slice(MAX_DROPPED_CSV_FILES).forEach((filePath) => {
    invalidResults.push(createInvalidResult(
      getSafeFileName(filePath),
      `Only ${MAX_DROPPED_CSV_FILES} files can be imported at once.`,
    ));
  });

  return { validFilePaths, invalidResults };
}

function getSafeFileName(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return "Unknown CSV file";
  }

  return path.basename(filePath);
}

function createInvalidResult(fileName, error) {
  return {
    ok: false,
    fileName,
    error,
  };
}

function createEmptyBatchResult() {
  return {
    ok: false,
    canceled: false,
    successfulCount: 0,
    failedCount: 0,
    results: [],
  };
}

module.exports = {
  MAX_DROPPED_CSV_FILES,
  importDroppedCsvFilesToSqlite,
  validateDroppedCsvFilePaths,
};
