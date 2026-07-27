/** Normalize a public example path without allowing traversal or URLs. */
export function normalizeExampleName(value) {
  const requested = String(value ?? '').trim();
  if (
    !/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*\.csv$/.test(requested) ||
    requested.includes('..')
  ) {
    return null;
  }
  return requested;
}

/**
 * Resolve an example using the legacy root lookup followed by the manifest.
 * The returned Blob has already passed missing-file and HTML-fallback checks.
 */
export async function fetchExampleBlob({ requested, baseUrl, fetchImpl }) {
  if (typeof fetchImpl !== 'function') return null;
  const examplesBase = `${String(baseUrl ?? '/').replace(/\/?$/, '/')}examples/`;

  if (requested.includes('/')) {
    return fetchCsvBlob(fetchImpl, `${examplesBase}${requested}`);
  }

  const legacyBlob = await fetchCsvBlob(fetchImpl, `${examplesBase}${requested}`);
  if (legacyBlob) return legacyBlob;

  try {
    const response = await fetchImpl(`${examplesBase}examples-index.json`, {
      cache: 'no-cache',
    });
    if (!response?.ok) return null;
    const index = await response.json();
    const match = (Array.isArray(index?.files) ? index.files : []).find((path) => {
      const safePath = normalizeExampleName(path);
      return safePath?.split('/').pop()?.toLowerCase() === requested.toLowerCase();
    });
    return match ? fetchCsvBlob(fetchImpl, `${examplesBase}${match}`) : null;
  } catch {
    return null;
  }
}

async function fetchCsvBlob(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response?.ok) return null;
    const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) return null;
    const blob = await response.blob();
    const prefix = await blob.slice(0, 512).text();
    const trimmed = prefix.trimStart().toLowerCase();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
      return null;
    }
    return blob;
  } catch {
    return null;
  }
}
