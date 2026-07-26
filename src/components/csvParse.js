import Papa from "papaparse";
import {
  collectCsvParserWarnings,
  csvRowToObject,
  isCsvRowEmpty,
  normalizeCsvHeaders,
  pushCsvWarning,
  warnForExtraCsvCells,
} from "../data/csvParsingCompatibility.js";

/**
 * Maximum number of rows shown in the preview table.
 * This is only for UI performance and readability.
 */
const MAX_PREVIEW_ROWS = 25;


/**
 * Size of each CSV chunk PapaParse reads at a time.
 * Keeping this explicit makes import tuning easier later.
 */
const CSV_UPLOAD_CHUNK_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Temporary safety cap for likely mobile/small-device large imports.
 * Full mobile optimization belongs in #60.
 */
const MOBILE_ROW_CAP = 500;
const MOBILE_LARGE_FILE_BYTES = 1 * 1024 * 1024;

/**
 * Parse a CSV file in a tolerant way.
 * - Uses what works
 * - Skips broken rows
 * - Reports problems without crashing
 *
 * @param {File} file - CSV file selected by the user
 * @returns {Promise<object>} Parsed CSV result
 */
export async function parseCsvFile(file) {
  return parseCsvBlob(file, {
    rowCap: shouldApplyMobileRowCap(file) ? MOBILE_ROW_CAP : null,
  });
}

/**
 * Parse CSV content from a Blob/File using PapaParse chunk loading.
 * Shared by uploaded files and fetched example CSVs.
 *
 * @param {Blob|File} blob - CSV data source
 * @param {object} options - parser options
 * @param {number|null} options.rowCap - optional cap for stored usable rows
 * @returns {Promise<object>} Parsed CSV result
 */
export async function parseCsvBlob(blob, { rowCap = null } = {}) {
  return new Promise((resolve) => {
    const state = createChunkParserState({
      rowCap,
    });

    Papa.parse(blob, {
      delimiter: "", // auto-detect delimiter
      skipEmptyLines: true,
      quoteChar: '"',
      escapeChar: '"',
      worker: true,
      chunkSize: CSV_UPLOAD_CHUNK_SIZE_BYTES,
      chunk: (result) => {
        processParsedChunk(state, result);
      },
      complete: () => {
        resolve(finalizeChunkedCsvResult(state));
      },
      error: (error) => {
        resolve(createParseFailureResult(error));
      },
    });
  });
}



/**
 * Create the shared state used while PapaParse sends file chunks.
 * This keeps parsing incremental without changing React state per row.
 */
function createChunkParserState({ rowCap = null } = {}) {
  return {
    headers: null,
    rows: [],
    parseErrors: [],
    skipped: 0,
    parsedRowCount: 0,
    usableRowCount: 0,
    sawParsedRows: false,
    rowCap,
  };
}

/**
 * Process one parsed file chunk.
 * Each chunk may contain parser errors and many CSV rows.
 */
function processParsedChunk(state, result) {
  collectCsvParserWarnings(state.parseErrors, result.errors);

  const data = Array.isArray(result.data) ? result.data : [];
  for (const rowArr of data) {
    state.sawParsedRows = true;
    state.parsedRowCount += 1;
    processParsedChunkRow(state, rowArr, state.parsedRowCount);
  }
}

/**
 * Process one parsed CSV row from a chunked CSV input.
 * The first non-empty row becomes the header; later rows become data objects.
 */
function processParsedChunkRow(state, rowArr, lineNumber) {
  if (!Array.isArray(rowArr)) {
    if (state.headers) {
      state.skipped++;
      pushCsvWarning(state.parseErrors, `Skipped non-row at line ${lineNumber}.`);
    }
    return;
  }

  if (isCsvRowEmpty(rowArr)) {
    return;
  }

  // The first non-empty row becomes the header row.
  if (!state.headers) {
    const headers = normalizeCsvHeaders(rowArr);

    if (headers.length === 0) {
      pushCsvWarning(state.parseErrors, "Header row is empty.");
      return;
    }

    state.headers = headers;
    return;
  }

  warnForExtraCsvCells(
    rowArr,
    state.headers,
    lineNumber,
    state.parseErrors,
  );

  // Count every usable data row, even if mobile safety stops storing later rows.
  state.usableRowCount += 1;

  // rows is what the preview and map use, so cap only this stored array.
  if (state.rowCap == null || state.rows.length < state.rowCap) {
    state.rows.push(csvRowToObject(rowArr, state.headers));
  }
}

/**
 * Build the final parsed result after all file chunks have finished.
 * This keeps the same result shape used by the rest of the app.
 */
function finalizeChunkedCsvResult(state) {
  if (!state.sawParsedRows) {
    return createEmptyResult([...state.parseErrors, "No rows detected."]);
  }

  if (!state.headers) {
    return createEmptyResult([...state.parseErrors, "No header row detected."]);
  }

  if (state.usableRowCount === 0) {
    pushCsvWarning(state.parseErrors, "No usable data rows were parsed.");
  }

  if (state.skipped > 0) {
    pushCsvWarning(
      state.parseErrors,
      `Skipped ${state.skipped} malformed row(s).`,
    );
  }

  // Show the cap as a normal parse warning instead of interrupting the user.
  if (state.rowCap != null && state.usableRowCount > state.rows.length) {
    pushCsvWarning(
      state.parseErrors,
      `Mobile safety: this large CSV was limited to the first ${state.rowCap} usable rows on this device. Use a desktop browser for the full dataset.`,
    );
  }

  // totalRows reports all usable rows, even when rows is capped.
  return createParsedResult(
    state.headers,
    state.rows,
    state.parseErrors,
    state.usableRowCount
  );
}

/**
 * Create the object shape that the CSV panel and map already expect.
 * totalRows can be larger than rows.length when mobile safety caps stored rows.
 */
function createParsedResult(headers, rows, parseErrors, totalRows = rows.length) {
  return {
    headers,
    rows,
    previewRows: rows.slice(0, MAX_PREVIEW_ROWS),
    totalRows,
    parseErrors,
  };
}

/**
 * Create an empty parse result with one or more user-facing warnings.
 */
function createEmptyResult(parseErrors) {
  return createParsedResult([], [], parseErrors);
}

/**
 * Convert a hard parser failure into the normal parsed result shape.
 * This lets the UI show an error without crashing the import flow.
 */
function createParseFailureResult(error) {
  const message = error?.message ? String(error.message) : "Unknown parser error.";
  return createEmptyResult([`Parser: ${message}`]);
}

/**
 * Decide whether this large upload should use the temporary mobile row cap.
 * The check is conservative and only protects likely small/mobile devices.
 */
function shouldApplyMobileRowCap(file) {
  if (!file || Number(file.size) < MOBILE_LARGE_FILE_BYTES) return false;

  const nav = globalThis.navigator;
  const screen = globalThis.screen;
  const hasCoarsePointer =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(pointer: coarse)").matches;
  const narrowScreen = Number(screen?.width) > 0 && screen.width <= 900;
  const lowMemory = Number(nav?.deviceMemory) > 0 && nav.deviceMemory <= 4;

  return hasCoarsePointer || narrowScreen || lowMemory;
}
