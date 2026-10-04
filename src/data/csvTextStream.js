import Papa from 'papaparse';

/** Bound unfinished CSV records, including quoted fields containing embedded newlines. */
export const MAX_CSV_RECORD_CHARACTERS = 64 * 1024 * 1024;
const DELIMITER_SAMPLE_CHARACTERS = 64 * 1024;

/**
 * Parse decoded CSV chunks with Papa's stateful parser handle, matching its own
 * chunk streamer's cursor/partial-record handling. Never split on newlines:
 * quoted cells may span lines or decompression chunks. Initial sampling delays
 * delimiter detection until sufficient text is available (or the file ends).
 *
 * @param {AsyncIterable<string>} chunks Decoded, optionally decompressed text.
 * @param {object} options Record-size limit and cancellation predicate.
 * @yields {object} PapaParse results containing complete records and warnings.
 */
export async function* readCsvTextChunks(chunks, options = {}) {
  const maximum = options.maximumRecordCharacters ?? MAX_CSV_RECORD_CHARACTERS;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('A positive CSV record limit is required.');
  const parser = new Papa.ParserHandle({
    delimiter: '', skipEmptyLines: true, quoteChar: '"', escapeChar: '"',
  });
  let partial = '';
  let cursor = 0;
  let started = false;
  for await (const chunk of chunks) {
    checkCanceled(options.shouldCancel);
    if (typeof chunk !== 'string') throw new TypeError('Decoded CSV text chunks are required.');
    const combined = partial + chunk;
    if (!started && combined.length < DELIMITER_SAMPLE_CHARACTERS) {
      if (combined.length > maximum) recordLimit();
      partial = combined;
      continue;
    }
    started = true;
    const result = parser.parse(combined, cursor, true);
    const nextCursor = result.meta.cursor;
    partial = combined.slice(nextCursor - cursor);
    if (partial.length > maximum) recordLimit();
    cursor = nextCursor;
    yield result;
  }
  checkCanceled(options.shouldCancel);
  yield parser.parse(partial, cursor, false);
}

/** Stop parsing before the importer processes another batch. */
function checkCanceled(shouldCancel) {
  if (shouldCancel?.()) throw Object.assign(new Error('Import canceled.'), { code: 'import-canceled' });
}

/** Fail the active file rather than retaining an unbounded partial record. */
function recordLimit() {
  throw Object.assign(new Error('A CSV record exceeds the supported size limit.'), { code: 'csv-record-size-limit' });
}
