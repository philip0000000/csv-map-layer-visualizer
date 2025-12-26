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
 * Parse a CSV file in a tolerant way.
 * - Uses what works
 * - Skips broken rows
 * - Reports problems without crashing
 *
 * @param {File} file - CSV file selected by the user
 * @returns {Promise<object>} Parsed CSV result
 */
export async function parseCsvFile(file) {
  // Read file as plain text (client-side only)
  const text = await file.text();

  /**
   * Clean input before parsing:
   * - Split into lines
   * - Trim whitespace
   * - Remove empty lines
   *
   * This avoids many common CSV problems early.
   */
  const cleaned = text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");

  // If nothing remains after cleaning, file is empty
  if (!cleaned) {
    return {
      headers: [],
      rows: [],
      previewRows: [],
      totalRows: 0,
      parseErrors: ["File is empty (or only blank lines)."],
    };
  }

  // Collect human-readable warnings and errors
  const parseErrors = [];

  /**
   * Parse CSV using PapaParse.
   * We do NOT use `header: true` because:
   * - We want full control over broken rows
   * - We want to allow truncation and repair
   */
  const result = Papa.parse(cleaned, {
    delimiter: "", // auto-detect delimiter
    skipEmptyLines: true,
    quoteChar: '"',
    escapeChar: '"',
  });

  // Convert PapaParse errors into user-friendly messages
  if (result.errors?.length) {
    for (const e of result.errors.slice(0, MAX_ERRORS)) {
      parseErrors.push(`Parser: ${e.message} (row ${e.row ?? "?"})`);
    }
  }

  // Ensure parsed data is an array
  const data = Array.isArray(result.data) ? result.data : [];
  if (data.length === 0) {
    return {
      headers: [],
      rows: [],
      previewRows: [],
      totalRows: 0,
      parseErrors: [...parseErrors, "No rows detected."],
    };
  }

  /**
   * Find the first non-empty row.
   * This row is treated as the header row.
   */
  const headerRow = firstNonEmptyArrayRow(data);
  if (!headerRow) {
    return {
      headers: [],
      rows: [],
      previewRows: [],
      totalRows: 0,
      parseErrors: [...parseErrors, "No header row detected."],
    };
  }

  // Normalize header names (trim, remove empty, ensure uniqueness)
  const rawHeaders = headerRow.map((h) => String(h ?? "").trim());
  const headers = normalizeHeaders(rawHeaders);

  if (headers.length === 0) {
    return {
      headers: [],
      rows: [],
      previewRows: [],
      totalRows: 0,
      parseErrors: [...parseErrors, "Header row is empty."],
    };
  }

  // All rows after the header are treated as data rows
  const headerIndex = data.indexOf(headerRow);
  const body = data.slice(headerIndex + 1);

  const rows = [];
  let skipped = 0;

  /**
   * Process each data row:
   * - Skip invalid rows
   * - Trim values
   * - Truncate extra columns
   * - Fill missing values with empty strings
   */
  for (let i = 0; i < body.length; i++) {
    const rowArr = body[i];

    // Skip rows that are not arrays
    if (!Array.isArray(rowArr)) {
      skipped++;
      pushErr(parseErrors, `Skipped non-row at line ${headerIndex + 2 + i}.`);
      continue;
    }

    // Skip fully empty rows
    if (rowArr.every((v) => String(v ?? "").trim() === "")) {
      continue;
    }

    // Normalize row length to match header length
    const normalizedValues = [];
    for (let c = 0; c < headers.length; c++) {
      normalizedValues[c] = String(rowArr[c] ?? "").trim();
    }

    // Warn if row had too many values
    if (rowArr.length > headers.length) {
      pushErr(
        parseErrors,
        `Line ${headerIndex + 2 + i}: had ${rowArr.length} values; truncated to ${headers.length}.`
      );
    }

    // Convert array row into object using headers as keys
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = normalizedValues[c];
    }

    rows.push(obj);
  }

  // If no usable rows were parsed, report it
  if (rows.length === 0) {
    pushErr(parseErrors, "No usable data rows were parsed.");
  }

  // Report skipped malformed rows
  if (skipped > 0) {
    pushErr(parseErrors, `Skipped ${skipped} malformed row(s).`);
  }

  // Final parsed result
  return {
    headers,
    rows,
    previewRows: rows.slice(0, MAX_PREVIEW_ROWS),
    totalRows: rows.length,
    parseErrors,
  };
}

/**
 * Returns the first row that:
 * - Is an array
 * - Contains at least one non-empty value
 */
function firstNonEmptyArrayRow(data) {
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const any = row.some((v) => String(v ?? "").trim() !== "");
    if (any) return row;
  }
  return null;
}

/**
 * Normalize header names:
 * - Trim whitespace
 * - Remove empty names
 * - Ensure uniqueness
 *
 * Example:
 * ["lat", "lon", "lat"] → ["lat", "lon", "lat_2"]
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


