import { getImportFileFormat } from './importFileFormats.js';

/** Keep expanded input finite even when a tiny gzip contains excessive output. */
export const DEFAULT_MAX_EXPANDED_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

/** A transport failure requires rollback of the entire active file import. */
export class ImportReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImportReadError';
    this.code = code;
  }
}

/**
 * Decode bounded byte chunks, optionally decompressing one gzip document first.
 * Accepts Blob.stream(), a WHATWG ReadableStream, or a Node async byte iterable.
 * Progress reports compressed/source bytes read separately from expanded bytes.
 * Natural EOF is required to validate the gzip trailer before an import commits.
 *
 * @param {ReadableStream|AsyncIterable<Uint8Array>} source Byte source.
 * @param {object} options Filename, cancellation, progress, and expanded-size limit.
 */
export async function* readImportTextChunks(source, options = {}) {
  const format = getImportFileFormat(options.fileName);
  if (!format) throw new ImportReadError('unsupported-format', 'Choose a CSV or GeoJSON file, optionally compressed with gzip.');
  const maximum = options.maximumExpandedBytes ?? DEFAULT_MAX_EXPANDED_IMPORT_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('A positive expanded byte limit is required.');
  let sourceBytes = 0;
  let expandedBytes = 0;
  let complete = false;
  let reader;
  const decoder = new TextDecoder('utf-8', { fatal: options.fatalUtf8 ?? format.format === 'geojson' });
  try {
    let stream = toReadableStream(source);
    stream = stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        checkCancellation(options.shouldCancel);
        if (!(chunk instanceof Uint8Array)) throw new TypeError('Import sources must provide byte chunks.');
        sourceBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }));
    if (format.compressed) {
      if (typeof DecompressionStream !== 'function') {
        throw new ImportReadError('gzip-unavailable', 'Gzip decompression is unavailable in this runtime.');
      }
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }
    reader = stream.getReader();
    while (true) {
      checkCancellation(options.shouldCancel);
      const result = await reader.read();
      if (result.done) break;
      checkCancellation(options.shouldCancel);
      expandedBytes += result.value.byteLength;
      if (expandedBytes > maximum) {
        throw new ImportReadError('import-size-limit', 'The expanded file exceeds the supported import size limit.');
      }
      const text = decoder.decode(result.value, { stream: true });
      options.onProgress?.({ sourceBytes, expandedBytes });
      if (text) yield text;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
    complete = true;
    options.onProgress?.({ sourceBytes, expandedBytes, complete: true });
  } catch (error) {
    if (error instanceof ImportReadError) throw error;
    throw new ImportReadError(format.compressed ? 'gzip-read-failed' : 'file-read-failed',
      format.compressed
        ? 'The gzip file could not be read or contains invalid compressed data or text.'
        : 'The file could not be read or contains invalid text.');
  } finally {
    // Early generator return, cancellation, and parse failures must close the source.
    if (reader) {
      if (!complete) {
        try { await reader.cancel(); } catch { /* Preserve the original import failure. */ }
      }
      reader.releaseLock();
    }
  }
}

/** Adapt Node byte iterators without prefetching the entire source file. */
function toReadableStream(source) {
  if (typeof source?.getReader === 'function') return source;
  if (typeof source?.[Symbol.asyncIterator] !== 'function') throw new TypeError('A byte stream is required.');
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  }, { highWaterMark: 0 });
}

/** Stop before additional decompression work or database batches can be requested. */
function checkCancellation(shouldCancel) {
  if (shouldCancel?.()) throw new ImportReadError('import-canceled', 'Import canceled.');
}
