/** Maximum number of parser and row warnings retained for one CSV file. */
export const MAX_CSV_PARSE_WARNINGS = 200;

/**
 * Add PapaParse-style errors to the shared warning list without depending on
 * PapaParse itself. This keeps the helper safe to import in a database worker.
 *
 * @param {string[]} warnings Mutable capped warning collection.
 * @param {Array<{ message?: unknown, row?: unknown }>} errors Parser errors.
 */
export function collectCsvParserWarnings(warnings, errors) {
  if (!Array.isArray(errors) || errors.length === 0) return;

  for (const error of errors) {
    pushCsvWarning(
      warnings,
      `Parser: ${String(error?.message ?? '')} (row ${error?.row ?? '?'})`,
    );
  }
}

/**
 * Return true when every value in an array row is blank after trimming.
 *
 * @param {unknown} row Candidate parser row.
 * @returns {boolean} Whether the row is an empty CSV row.
 */
export function isCsvRowEmpty(row) {
  return Array.isArray(row) &&
    row.every((value) => String(value ?? '').trim() === '');
}

/**
 * Normalize CSV headers using the existing browser rules.
 *
 * Blank names are removed and duplicate names receive `_2`, `_3`, and later
 * suffixes in their original order.
 *
 * @param {unknown[]} rawHeaders Parsed header cells.
 * @returns {string[]} Ordered normalized headers.
 */
export function normalizeCsvHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders)) return [];
  const seen = new Map();
  const normalized = [];

  for (const value of rawHeaders) {
    const base = String(value ?? '').trim();
    if (!base) continue;

    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    normalized.push(count === 1 ? base : `${base}_${count}`);
  }

  return normalized;
}

/**
 * Convert one CSV array row to an object using normalized ordered headers.
 *
 * Missing cells become empty strings, values are trimmed, and extra cells are
 * ignored. Extra-cell warning collection remains a separate call so capped
 * imports do not need to allocate a row object merely to retain the warning.
 *
 * @param {unknown[]} row Parsed CSV data row.
 * @param {string[]} headers Normalized ordered headers.
 * @returns {Record<string, string>} Normalized row object.
 */
export function csvRowToObject(row, headers) {
  const normalizedRow = {};

  for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
    normalizedRow[headers[columnIndex]] =
      String(row[columnIndex] ?? '').trim();
  }

  return normalizedRow;
}

/**
 * Retain the existing warning when a data row contains more values than the
 * normalized header list.
 *
 * @param {unknown[]} row Parsed CSV data row.
 * @param {string[]} headers Normalized ordered headers.
 * @param {number} lineNumber One-based parsed row number.
 * @param {string[]} warnings Mutable capped warning collection.
 */
export function warnForExtraCsvCells(
  row,
  headers,
  lineNumber,
  warnings,
) {
  if (row.length <= headers.length) return;
  pushCsvWarning(
    warnings,
    `Line ${lineNumber}: had ${row.length} values; truncated to ${headers.length}.`,
  );
}

/**
 * Append one warning unless the per-file compatibility cap has been reached.
 *
 * @param {string[]} warnings Mutable warning collection.
 * @param {unknown} message Warning text.
 * @returns {boolean} True when the warning was retained.
 */
export function pushCsvWarning(warnings, message) {
  if (
    !Array.isArray(warnings) ||
    warnings.length >= MAX_CSV_PARSE_WARNINGS
  ) {
    return false;
  }

  warnings.push(String(message));
  return true;
}
