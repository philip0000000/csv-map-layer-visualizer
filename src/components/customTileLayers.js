export const BUILT_IN_TILE_LAYER_NAMES = Object.freeze([
  "Blank background",
  "Normal (OSM)",
  "Satellite (Esri)",
  "Labels + boundaries",
]);

const REQUIRED_XYZ_PLACEHOLDERS = Object.freeze(["z", "x", "y"]);
const SUPPORTED_XYZ_PLACEHOLDERS = new Set(["z", "x", "y", "s", "r"]);
const CUSTOM_TILE_LAYER_TYPES = new Set(["background", "overlay"]);

/** Return the canonical comparison key used for custom and built-in layer names. */
export function getTileLayerNameKey(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/** Namespace runtime IDs so valid custom names cannot collide with built-in layer state. */
export function getCustomTileLayerId(name) {
  return `custom:${getTileLayerNameKey(name)}`;
}

/** Escape plain user text before passing it to Leaflet's HTML-based controls. */
export function escapeLeafletText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Validate a raster XYZ form value and return only normalized, persistable fields. */
export function validateCustomTileLayerInput(input, options = {}) {
  const errors = {};
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  const attribution = typeof input?.attribution === "string"
    ? input.attribution.trim()
    : "";
  const type = typeof input?.type === "string" ? input.type : "";
  const maxZoomResult = normalizeMaximumZoom(input?.maxZoom);

  if (!name) {
    errors.name = "Enter a layer name.";
  } else {
    const existingNameKeys = new Set([
      ...BUILT_IN_TILE_LAYER_NAMES,
      ...(options.existingNames ?? []),
    ].map(getTileLayerNameKey));
    if (existingNameKeys.has(getTileLayerNameKey(name))) {
      errors.name = "Choose a unique layer name.";
    }
  }

  const urlError = validateXyzTileUrl(url);
  if (urlError) errors.url = urlError;
  if (maxZoomResult.error) errors.maxZoom = maxZoomResult.error;
  if (!CUSTOM_TILE_LAYER_TYPES.has(type)) {
    errors.type = "Choose Background or Overlay.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      url,
      attribution,
      maxZoom: maxZoomResult.value,
      type,
    },
    errors: {},
  };
}

/** Revalidate persisted entries, ignore invalid records, and restore creation order. */
export function normalizePersistedCustomTileLayers(entries) {
  if (!Array.isArray(entries)) return [];

  const normalized = [];
  const existingNames = [];
  const usedOrders = new Set();

  // Sorting before duplicate checks preserves the earliest valid definition after corruption.
  const orderedEntries = [...entries].sort((left, right) => (
    Number(left?.creationOrder) - Number(right?.creationOrder)
  ));
  for (const entry of orderedEntries) {
    const creationOrder = entry?.creationOrder;
    if (!Number.isSafeInteger(creationOrder) || creationOrder < 0) continue;
    if (usedOrders.has(creationOrder)) continue;

    const result = validateCustomTileLayerInput(entry, { existingNames });
    if (!result.ok) continue;

    normalized.push({
      ...result.value,
      id: getCustomTileLayerId(result.value.name),
      creationOrder,
    });
    existingNames.push(result.value.name);
    usedOrders.add(creationOrder);
  }

  return normalized.sort((left, right) => left.creationOrder - right.creationOrder);
}

/** Build a new runtime definition after validating it against current layer names. */
export function createCustomTileLayer(input, options = {}) {
  const result = validateCustomTileLayerInput(input, options);
  if (!result.ok) return result;

  const creationOrder = Number.isSafeInteger(options.creationOrder)
    ? options.creationOrder
    : 0;
  return {
    ...result,
    value: {
      ...result.value,
      id: getCustomTileLayerId(result.value.name),
      creationOrder,
    },
  };
}

/** Validate supported placeholders and the parsed protocol without requesting a tile. */
function validateXyzTileUrl(url) {
  if (!url) return "Enter a tile URL.";

  const placeholders = [...url.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]);
  const withoutCompletePlaceholders = url.replaceAll(/\{[^{}]*\}/g, "");
  if (withoutCompletePlaceholders.includes("{") || withoutCompletePlaceholders.includes("}")) {
    return "The tile URL contains a malformed placeholder.";
  }

  const unsupported = placeholders.find((placeholder) => (
    !SUPPORTED_XYZ_PLACEHOLDERS.has(placeholder)
  ));
  if (unsupported !== undefined) {
    return `Unsupported placeholder {${unsupported}}. Use lowercase {z}, {x}, {y}, {s}, or {r}.`;
  }

  const missing = REQUIRED_XYZ_PLACEHOLDERS.filter((required) => (
    !placeholders.includes(required)
  ));
  if (missing.length > 0) {
    return `Tile URL must include ${missing.map((value) => `{${value}}`).join(", ")}.`;
  }

  let parsed;
  try {
    // Substitute only for parsing; the original Leaflet template remains unchanged.
    const parseableUrl = url.replaceAll(/\{([zxysr])\}/g, (_match, placeholder) => (
      placeholder === "s" ? "a" : "1"
    ));
    parsed = new URL(parseableUrl);
  } catch {
    return "Enter a valid absolute tile URL.";
  }

  if (parsed.username || parsed.password) {
    return "Remove the username or password from the URL authority.";
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol !== "http:") {
    return "Use HTTPS, or HTTP only for an exact loopback address.";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    return "Remote HTTP tile services are not allowed. Use HTTPS instead.";
  }

  return null;
}

/** Convert an optional maximum zoom input without inventing a provider default. */
function normalizeMaximumZoom(value) {
  if (value === "" || value === null || value === undefined) {
    return { value: null, error: null };
  }

  const text = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^\d+$/.test(text)) {
    return { value: null, error: "Maximum zoom must be a non-negative whole number." };
  }

  const number = Number(text);
  if (!Number.isSafeInteger(number)) {
    return { value: null, error: "Maximum zoom must be a non-negative whole number." };
  }
  return { value: number, error: null };
}
