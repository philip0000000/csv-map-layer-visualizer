/** Bound one JSON token/feature so a malformed document cannot grow memory forever. */
export const MAX_GEOJSON_VALUE_CHARACTERS = 64 * 1024 * 1024;
const MAX_JSON_DEPTH = 128;

/** Signal a document-level failure: the caller must roll back the active import. */
export class GeojsonDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeojsonDocumentError';
    this.code = 'geojson-document-invalid';
  }
}

/**
 * Read JSON text incrementally, yielding each FeatureCollection item independently.
 * JSON syntax is validated even after the last feature. The root document is checked
 * at EOF, so yielded items must remain in a provisional transaction until completion.
 * A standalone Feature or geometry is necessarily buffered as one bounded value.
 * Collection foreign members are returned through onMetadata, without its features.
 *
 * Replayable sources are probed for the root type without retaining their values.
 * This keeps collections with a late type member incremental, while allowing a
 * standalone object's foreign features member in any order. One-shot sources
 * buffer an ambiguous root array within the existing standalone-value limit.
 *
 * @param {AsyncIterable<string>|function} chunks Text fragments or a replayable source factory.
 * @param {object} options Cancellation predicate, size limit, and metadata callback.
 */
export async function* readGeojsonFeatures(chunks, options = {}) {
  const maximum = options.maximumValueCharacters ?? MAX_GEOJSON_VALUE_CHARACTERS;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('A positive size limit is required.');
  const replayable = typeof chunks === 'function';
  const rootType = replayable ? await probeRootType(chunks(true), maximum, options.shouldCancel) : undefined;
  if (replayable) chunks = chunks(false);
  const frames = [];
  let root;
  let hasRoot = false;
  let streamedFeatures = false;
  let valueCharacters = 0;
  let metadataCharacters = 0;

  for await (const token of tokenizeJson(chunks, maximum, options.shouldCancel)) {
    checkCanceled(options.shouldCancel);
    const parent = frames.at(-1);
    // Root foreign metadata is retained as one object, so bound its aggregate
    // size independently of the feature stream, including members following it.
    if (!frames[1]?.streamItems) metadataCharacters += token.size;
    if (metadataCharacters > maximum) invalid('GeoJSON document metadata exceeds the supported size limit.');
    // Count an individual feature (or standalone root), not the entire collection.
    if (!streamedFeatures || frames.length > 2) valueCharacters += token.size;
    if (valueCharacters > maximum) invalid('A GeoJSON value exceeds the supported size limit.');
    if (hasRoot && frames.length === 0) invalid('Unexpected content after the JSON document.');

    if (token.kind === '}' || token.kind === ']') {
      if (!parent || (token.kind === '}' ? parent.kind !== 'object' : parent.kind !== 'array')) {
        invalid('Mismatched JSON brackets.');
      }
      if (!['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(parent.state)) {
        invalid('Incomplete JSON value or trailing comma.');
      }
      frames.pop();
      const emitted = attach(parent.value);
      if (emitted.ready) {
        valueCharacters = 0;
        yield emitted.value;
      }
      continue;
    }
    if (token.kind === ',') {
      if (!parent || parent.state !== 'commaOrEnd') invalid('Unexpected JSON comma.');
      parent.state = parent.kind === 'object' ? 'key' : 'value';
      continue;
    }
    if (token.kind === ':') {
      if (!parent || parent.state !== 'colon') invalid('Unexpected JSON colon.');
      parent.state = 'value';
      continue;
    }
    if (parent?.kind === 'object' && ['key', 'keyOrEnd'].includes(parent.state)) {
      if (token.kind !== 'value' || typeof token.value !== 'string') invalid('JSON keys must be strings.');
      if (parent.keys.has(token.value)) invalid('Duplicate JSON members are ambiguous.');
      parent.keys.add(token.value);
      parent.key = token.value;
      parent.state = 'colon';
      continue;
    }
    if (parent && !['value', 'valueOrEnd'].includes(parent.state)) invalid('Expected a JSON separator.');
    if (token.kind === '{' || token.kind === '[') {
      if (frames.length >= MAX_JSON_DEPTH) invalid('JSON nesting exceeds the supported limit.');
      const kind = token.kind === '{' ? 'object' : 'array';
      const streamItems = kind === 'array' && frames.length === 1
        && parent.kind === 'object' && parent.key === 'features'
        && (parent.value.type === 'FeatureCollection' || rootType === 'FeatureCollection');
      if (streamItems) {
        streamedFeatures = true;
        options.onCollectionStart?.();
        valueCharacters = 0;
      }
      frames.push({ kind, value: kind === 'object' ? {} : [],
        state: kind === 'object' ? 'keyOrEnd' : 'valueOrEnd',
        keys: new Set(), key: null, streamItems });
    } else if (token.kind === 'value') {
      const emitted = attach(token.value);
      if (emitted.ready) {
        valueCharacters = 0;
        yield emitted.value;
      }
    } else invalid('Unexpected JSON token.');
  }
  if (!hasRoot || frames.length) invalid('The GeoJSON document is incomplete.');
  if (!root || typeof root !== 'object' || Array.isArray(root)) invalid('A GeoJSON root object is required.');
  if (root.type === 'FeatureCollection') {
    if (!streamedFeatures) {
      if (!Array.isArray(root.features)) invalid('A FeatureCollection requires a features array.');
      options.onCollectionStart?.();
      for (const feature of root.features) {
        checkCanceled(options.shouldCancel);
        yield feature;
      }
    }
    const { features: _features, ...metadata } = root;
    options.onMetadata?.(metadata);
  } else {
    if (streamedFeatures) invalid('Only a FeatureCollection may contain a streamed features array.');
    yield root;
  }

  /** Attach one completed value while releasing streamed items immediately. */
  function attach(value) {
    const frame = frames.at(-1);
    if (!frame) {
      root = value;
      hasRoot = true;
      return { ready: false };
    }
    let ready = false;
    if (frame.kind === 'object') {
      // Define own data properties so __proto__ remains metadata rather than a setter.
      Object.defineProperty(frame.value, frame.key, {
        value, enumerable: true, configurable: true, writable: true,
      });
      frame.key = null;
    } else if (frame.streamItems) ready = true;
    else frame.value.push(value);
    frame.state = 'commaOrEnd';
    return { ready, value };
  }
}

/**
 * Tokenize across arbitrary chunk boundaries, retaining only the unfinished token.
 * JSON.parse validates string escapes, literals, and number grammar; punctuation
 * and document structure are validated separately by the streaming reader.
 */
async function* tokenizeJson(chunks, maximum, shouldCancel) {
  let pending = '';
  let quoted = false;
  let escaped = false;
  let firstCharacter = true;
  for await (const chunk of chunks) {
    checkCanceled(shouldCancel);
    if (typeof chunk !== 'string') throw new TypeError('Decoded text chunks are required.');
    for (const character of chunk) {
      if (firstCharacter) {
        firstCharacter = false;
        if (character === '\uFEFF') continue;
      }
      if (quoted) {
        pending += character;
        if (pending.length > maximum) invalid('A JSON token exceeds the supported size limit.');
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') {
          quoted = false;
          yield parseToken(pending);
          pending = '';
        }
        continue;
      }
      const punctuation = '{}[]:,'.includes(character);
      const whitespace = /[\x20\t\r\n]/.test(character);
      if (punctuation || whitespace || character === '"') {
        if (pending) {
          yield parseToken(pending);
          pending = '';
        }
        if (punctuation) yield { kind: character, size: 1 };
        else if (character === '"') {
          pending = character;
          quoted = true;
        }
      } else {
        pending += character;
        if (pending.length > maximum) invalid('A JSON token exceeds the supported size limit.');
      }
    }
  }
  if (quoted) invalid('Unterminated JSON string.');
  if (pending) yield parseToken(pending);
}

/** Decode exactly one primitive token, rejecting compound values and non-finite numbers. */
function parseToken(text) {
  try {
    const value = JSON.parse(text);
    if (value !== null && typeof value === 'object'
      || typeof value === 'number' && !Number.isFinite(value)) invalid('Invalid JSON token.');
    return { kind: 'value', value, size: text.length };
  } catch {
    invalid('Invalid JSON string, number, or literal.');
  }
}

/** Cooperatively cancel before consuming more input or emitting more features. */
function checkCanceled(shouldCancel) {
  if (shouldCancel?.()) {
    throw Object.assign(new Error('Import canceled.'), { code: 'import-canceled' });
  }
}

/** Convert unrecoverable JSON syntax failures to a document-level error. */
function invalid(message) {
  throw new GeojsonDocumentError(message);
}

/** Inspect only top-level type; nested values are discarded and the source closes on return. */
async function probeRootType(chunks, maximum, shouldCancel) {
  let depth = 0;
  let key = null;
  let state = 'key';
  for await (const token of tokenizeJson(chunks, maximum, shouldCancel)) {
    if (depth === 1) {
      if (state === 'key' && token.kind === 'value') { key = token.value; state = 'colon'; }
      else if (state === 'colon' && token.kind === ':') state = 'value';
      else if (state === 'value') {
        if (key === 'type' && token.kind === 'value') return token.value;
        state = 'comma';
      } else if (token.kind === ',') state = 'key';
    }
    if (token.kind === '{' || token.kind === '[') depth++;
    if (token.kind === '}' || token.kind === ']') depth--;
  }
  return undefined;
}
