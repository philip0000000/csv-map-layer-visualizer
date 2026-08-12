export const MAX_INLINE_IMAGES_PER_ROW = 10;

const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const WHITESPACE_PATTERN = /\s/;

/**
 * Parse only the link and image forms supported in marker-detail values.
 * A scanner keeps unmatched punctuation and surrounding text byte-for-byte intact.
 */
export function parseMarkerDetailInlineContent(value) {
  const source = String(value ?? '');
  const tokens = [];
  let textStart = 0;
  let index = 0;

  while (index < source.length) {
    const escapedStart = getEscapedMarkupStart(source, index);
    if (escapedStart != null) {
      const escapedMarkup = readMarkup(source, escapedStart);
      if (escapedMarkup) {
        appendText(tokens, source.slice(textStart, index));
        appendText(tokens, escapedMarkup.raw);
        index = escapedMarkup.end;
        textStart = index;
        continue;
      }
    }

    const markup = readMarkup(source, index);
    if (markup) {
      appendText(tokens, source.slice(textStart, index));
      tokens.push(markup.token);
      index = markup.end;
      textStart = index;
      continue;
    }

    index += 1;
  }

  appendText(tokens, source.slice(textStart));
  return tokens;
}

/** Create a mutable budget that is deliberately shared by every field in one row. */
export function createInlineImageBudget(limit = MAX_INLINE_IMAGES_PER_ROW) {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 0;
  return { remaining: Math.max(0, normalizedLimit) };
}

/**
 * Validate parsed targets and apply a row-level image budget before rendering.
 * Unsupported markup is converted back to its complete original plain text.
 */
export function prepareMarkerDetailInlineContent(value, options = {}) {
  const imageBudget = options.imageBudget ?? createInlineImageBudget();
  const prepared = [];

  for (const token of parseMarkerDetailInlineContent(value)) {
    if (token.type === 'text') {
      appendText(prepared, token.text);
      continue;
    }

    if (token.type === 'link') {
      const url = getSafeHttpUrl(token.target);
      if (!url) {
        appendText(prepared, token.raw);
        continue;
      }

      prepared.push({ ...token, url });
      continue;
    }

    const url = resolveMarkerDetailImageUrl(token.target, options);
    if (!url || imageBudget.remaining <= 0) {
      appendText(prepared, token.raw);
      continue;
    }

    imageBudget.remaining -= 1;
    prepared.push({ ...token, url });
  }

  return prepared;
}

/** Return a normalized HTTP(S) URL, or null for malformed and unsafe targets. */
export function getSafeHttpUrl(target) {
  if (!hasSafeTargetText(target)) return null;

  try {
    const url = new URL(target);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a supported inline-image target against the configured application base.
 * Relative paths are checked before URL resolution so normalization cannot hide traversal.
 */
export function resolveMarkerDetailImageUrl(target, options = {}) {
  const externalUrl = getSafeHttpUrl(target);
  if (externalUrl) return externalUrl;
  if (!isSafeAppRelativeImagePath(target)) return null;

  const locationUrl = options.locationUrl ?? getBrowserLocationUrl();
  const baseUrl = options.baseUrl ?? '/';
  if (!locationUrl || !hasSafeTargetText(baseUrl)) return null;

  try {
    const applicationBaseUrl = new URL(baseUrl, locationUrl);
    return new URL(target, applicationBaseUrl).href;
  } catch {
    return null;
  }
}

/** Apply the issue's explicit app-relative path restrictions before loading an image. */
export function isSafeAppRelativeImagePath(target) {
  if (!hasSafeTargetText(target)) return false;
  if (target.startsWith('/') || target.includes('\\')) return false;
  if (SCHEME_PATTERN.test(target)) return false;

  const path = target.split(/[?#]/, 1)[0];
  if (!path || path.lastIndexOf('/') <= 0) return false;

  return path.split('/').every((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      // Encoded separators could otherwise disguise a traversal segment.
      return decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
    } catch {
      return false;
    }
  });
}

/** Read one exact `](target)` form without interpreting any other Markdown. */
function readMarkup(source, start) {
  const isImage = source.startsWith('![', start);
  if (!isImage && source[start] !== '[') return null;

  const labelStart = start + (isImage ? 2 : 1);
  const labelEnd = source.indexOf(']', labelStart);
  if (labelEnd < 0 || source[labelEnd + 1] !== '(') return null;

  const targetStart = labelEnd + 2;
  const targetEnd = findTargetEnd(source, targetStart);
  if (targetEnd < 0) return null;

  const end = targetEnd + 1;
  const raw = source.slice(start, end);
  return {
    end,
    raw,
    token: {
      type: isImage ? 'image' : 'link',
      text: source.slice(labelStart, labelEnd),
      target: source.slice(targetStart, targetEnd),
      raw,
    },
  };
}

/** Find the closing delimiter while preserving balanced parentheses inside a URL. */
function findTargetEnd(source, targetStart) {
  let nestedParentheses = 0;

  for (let index = targetStart; index < source.length; index += 1) {
    if (source[index] === '(') {
      nestedParentheses += 1;
      continue;
    }

    if (source[index] !== ')') continue;
    if (nestedParentheses === 0) return index;
    nestedParentheses -= 1;
  }

  return -1;
}

function getEscapedMarkupStart(source, index) {
  if (source[index] !== '\\') return null;
  if (source.startsWith('![', index + 1)) return index + 1;
  if (source[index + 1] === '[') return index + 1;
  return null;
}

function appendText(tokens, text) {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.type === 'text') {
    previous.text += text;
    return;
  }
  tokens.push({ type: 'text', text });
}

function hasSafeTargetText(target) {
  return typeof target === 'string' &&
    target.length > 0 &&
    target === target.trim() &&
    !WHITESPACE_PATTERN.test(target) &&
    !containsControlCharacter(target);
}

function containsControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function getBrowserLocationUrl() {
  return typeof globalThis.location?.href === 'string'
    ? globalThis.location.href
    : null;
}
