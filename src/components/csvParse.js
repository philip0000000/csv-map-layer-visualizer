import Papa from "papaparse";

/**
 * Maximum number of rows shown in the preview table.
 * This is only for UI performance and readability.
 */
const MAX_PREVIEW_ROWS = 25;

/**
 * Maximum number of error messages we keep.
 * Prevents flooding the UI if a file is very broken.
 */
const MAX_ERRORS = 200;

/**
 * Size of each uploaded file chunk PapaParse reads at a time.
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
  return new Promise((resolve) => {
    const state = createChunkParserState({
      rowCap: shouldApplyMobileRowCap(file) ? MOBILE_ROW_CAP : null,
    });

    Papa.parse(file, {
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
 * Parse CSV content from a string.
 * Used for loading example CSVs via fetch() from /public/examples.
 *
 * @param {string} text - raw CSV text
 * @returns {object} Parsed CSV result
 */
export function parseCsvText(text) {
  const cleaned = prepareCsvText(text);

  // If nothing remains after cleaning, file is empty
  if (!cleaned) {
    return createEmptyResult(["File is empty (or only blank lines)."]);
  }

  // Collect human-readable warnings and errors
  const parseErrors = [];

  /**
   * Parse CSV using PapaParse.
   * We do NOT use `header: true` because:
   * - We want full control over broken rows
   * - We want to allow truncation and repair
   */
  const result = parseTextToArrays(cleaned);

  // Convert PapaParse errors into user-friendly messages
  collectParserErrors(parseErrors, result.errors);

  // Ensure parsed data is an array
  const data = Array.isArray(result.data) ? result.data : [];
  if (data.length === 0) {
    return createEmptyResult([...parseErrors, "No rows detected."]);
  }

  return buildParsedCsvResult(data, parseErrors);
}

/**
 * Clean input before parsing:
 * - Split into lines
 * - Trim whitespace
 * - Remove empty lines
 *
 * This avoids many common CSV problems early.
 */
function prepareCsvText(text) {
  return String(text ?? "")
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/**
 * Parse cleaned CSV text into arrays.
 * This path is used by example CSV files, not uploaded files.
 */
function parseTextToArrays(text) {
  return Papa.parse(text, {
    delimiter: "", // auto-detect delimiter
    skipEmptyLines: true,
    quoteChar: '"',
    escapeChar: '"',
  });
}

/**
 * Add PapaParse errors to our user-facing warning list.
 * The list is capped so a broken file cannot flood the UI.
 */
function collectParserErrors(parseErrors, errors) {
  if (!errors?.length) return;

  for (const e of errors.slice(0, MAX_ERRORS)) {
    pushErr(parseErrors, `Parser: ${e.message} (row ${e.row ?? "?"})`);
  }
}

/**
 * Create the shared state used while PapaParse sends file chunks.
 * This keeps upload parsing incremental without changing React state per row.
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
  collectParserErrors(state.parseErrors, result.errors);

  const data = Array.isArray(result.data) ? result.data : [];
  for (const rowArr of data) {
    state.sawParsedRows = true;
    state.parsedRowCount += 1;
    processParsedChunkRow(state, rowArr, state.parsedRowCount);
  }
}

/**
 * Process one parsed CSV row from an uploaded file.
 * The first non-empty row becomes the header; later rows become data objects.
 */
function processParsedChunkRow(state, rowArr, lineNumber) {
  if (!Array.isArray(rowArr)) {
    if (state.headers) {
      state.skipped++;
      pushErr(state.parseErrors, `Skipped non-row at line ${lineNumber}.`);
    }
    return;
  }

  if (isEmptyRow(rowArr)) {
    return;
  }

  // The first non-empty row in the upload becomes the header row.
  if (!state.headers) {
    const rawHeaders = rowArr.map((h) => String(h ?? "").trim());
    const headers = normalizeHeaders(rawHeaders);

    if (headers.length === 0) {
      pushErr(state.parseErrors, "Header row is empty.");
      return;
    }

    state.headers = headers;
    return;
  }

  if (rowArr.length > state.headers.length) {
    pushErr(
      state.parseErrors,
      `Line ${lineNumber}: had ${rowArr.length} values; truncated to ${state.headers.length}.`
    );
  }

  // Count every usable data row, even if mobile safety stops storing later rows.
  state.usableRowCount += 1;

  // rows is what the preview and map use, so cap only this stored array.
  if (state.rowCap == null || state.rows.length < state.rowCap) {
    state.rows.push(rowArrayToObject(rowArr, state.headers));
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
    pushErr(state.parseErrors, "No usable data rows were parsed.");
  }

  if (state.skipped > 0) {
    pushErr(state.parseErrors, `Skipped ${state.skipped} malformed row(s).`);
  }

  // Show the cap as a normal parse warning instead of interrupting the user.
  if (state.rowCap != null && state.usableRowCount > state.rows.length) {
    pushErr(
      state.parseErrors,
      `Mobile safety: this large CSV was limited to the first ${state.rowCap} usable rows on this device. Use a desktop browser for the full dataset.`
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
 * Build a parsed result from already-loaded CSV array data.
 * This is the string/example CSV path, so it keeps the old behavior.
 */
function buildParsedCsvResult(data, parseErrors) {
  /**
   * Find the first non-empty row.
   * This row is treated as the header row.
   */
  const headerRow = firstNonEmptyArrayRow(data);
  if (!headerRow) {
    return createEmptyResult([...parseErrors, "No header row detected."]);
  }

  // Normalize header names (trim, remove empty, ensure uniqueness)
  const rawHeaders = headerRow.map((h) => String(h ?? "").trim());
  const headers = normalizeHeaders(rawHeaders);

  if (headers.length === 0) {
    return createEmptyResult([...parseErrors, "Header row is empty."]);
  }

  // All rows after the header are treated as data rows
  const headerIndex = data.indexOf(headerRow);
  const rows = [];
  let skipped = 0;

  /**
   * Process each data row:
   * - Skip invalid rows
   * - Trim values
   * - Truncate extra columns
   * - Fill missing values with empty strings
   */
  for (let i = headerIndex + 1; i < data.length; i++) {
    const rowArr = data[i];
    const lineNumber = i + 1;

    // Skip rows that are not arrays
    if (!Array.isArray(rowArr)) {
      skipped++;
      pushErr(parseErrors, `Skipped non-row at line ${lineNumber}.`);
      continue;
    }

    // Skip fully empty rows
    if (isEmptyRow(rowArr)) {
      continue;
    }

    // Warn if row had too many values
    if (rowArr.length > headers.length) {
      pushErr(
        parseErrors,
        `Line ${lineNumber}: had ${rowArr.length} values; truncated to ${headers.length}.`
      );
    }

    rows.push(rowArrayToObject(rowArr, headers));
  }

  // If no usable rows were parsed, report it
  if (rows.length === 0) {
    pushErr(parseErrors, "No usable data rows were parsed.");
  }

  // Report skipped malformed rows
  if (skipped > 0) {
    pushErr(parseErrors, `Skipped ${skipped} malformed row(s).`);
  }

  return createParsedResult(headers, rows, parseErrors);
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

/**
 * Returns the first row that:
 * - Is an array
 * - Contains at least one non-empty value
 */
function firstNonEmptyArrayRow(data) {
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    if (!isEmptyRow(row)) return row;
  }
  return null;
}

/**
 * True when every cell in a parsed row is blank after trimming.
 */
function isEmptyRow(row) {
  return row.every((v) => String(v ?? "").trim() === "");
}

/**
 * Convert one parsed row into an object using normalized headers.
 * Missing cells become empty strings; extra cells are ignored after warning.
 */
function rowArrayToObject(rowArr, headers) {
  const obj = {};

  for (let c = 0; c < headers.length; c++) {
    obj[headers[c]] = String(rowArr[c] ?? "").trim();
  }

  return obj;
}

/**
 * Normalize header names:
 * - Trim whitespace
 * - Remove empty names
 * - Ensure uniqueness
 *
 * Example:
 * ["lat", "lon", "lat"] -> ["lat", "lon", "lat_2"]
 */
function normalizeHeaders(raw) {
  const seen = new Map();
  const out = [];

  for (let i = 0; i < raw.length; i++) {
    const base = raw[i].trim();
    if (!base) continue;

    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);

    out.push(count === 1 ? base : `${base}_${count}`);
  }

  return out;
}

/**
 * Add an error message if limit is not reached.
 * Prevents memory and UI overload.
 */
function pushErr(list, msg) {
  if (list.length < MAX_ERRORS) {
    list.push(msg);
  }
}
