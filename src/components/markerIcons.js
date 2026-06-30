import L from "leaflet";

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|svg|webp|gif)$/i;
const DEFAULT_IMAGE_SIZE = [32, 32];
const DEFAULT_IMAGE_ANCHOR = [16, 32];
const DEFAULT_TEXT_ANCHOR = [0, 16];
const DEFAULT_GROUPED_ANCHOR = [16, 16];

const iconCache = new Map();
const clusterIconCache = new Map();
const DEFAULT_LEAFLET_ICON = new L.Icon.Default();

function isImageMarkerValue(value) {
  return (
    value.startsWith("/") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    IMAGE_EXTENSION_RE.test(value)
  );
}

function resolveImageUrl(value) {
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `/icons/${value}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function createTextMarkerIcon(value) {
  return L.divIcon({
    className: "csv-marker-text-icon",
    html: `<span class="csv-marker-text">${escapeHtml(value)}</span>`,
    iconSize: null,
    iconAnchor: DEFAULT_TEXT_ANCHOR,
    popupAnchor: [0, -16],
  });
}

function createImageMarkerIcon(value) {
  const iconUrl = resolveImageUrl(value);

  const icon = L.icon({
    iconUrl,
    iconSize: DEFAULT_IMAGE_SIZE,
    iconAnchor: DEFAULT_IMAGE_ANCHOR,
    popupAnchor: [0, -32],
  });

  const originalCreateIcon = icon.createIcon.bind(icon);

  // Fall back to default marker image if loading fails.
  icon.createIcon = (oldIcon) => {
    const img = originalCreateIcon(oldIcon);

    if (img && img.tagName === "IMG") {
      img.onerror = () => {
        img.onerror = null; // prevent loop
        try {
          const fallback = DEFAULT_LEAFLET_ICON.createIcon();
          img.src = fallback.src;
          img.width = fallback.width || 25;
          img.height = fallback.height || 41;
        } catch {
          // Ignore fallback errors and keep map render safe.
        }
      };
    }

    return img;
  };

  return icon;
}

/**
 * Create the Leaflet divIcon used for marker clusters.
 * It shows the chosen marker style plus a compact count badge.
 */
function createClusterMarkerIcon(markerValue, count) {
  const normalized = String(markerValue ?? "").trim();
  const safeCount = formatGroupedPointCount(count);
  const bodyHtml = createClusterMarkerBodyHtml(normalized);

  return L.divIcon({
    className: "csv-marker-group-icon",
    html: `<span class="csv-marker-group">${bodyHtml}<span class="csv-marker-group-count">${safeCount}</span></span>`,
    iconSize: [32, 32],
    iconAnchor: DEFAULT_GROUPED_ANCHOR,
    popupAnchor: [0, -16],
  });
}

/**
 * Render the visual body of a cluster icon.
 * Empty marker values get a neutral badge body; image/text markers keep their style.
 */
function createClusterMarkerBodyHtml(normalized) {
  if (!normalized) {
    return `<span class="csv-marker-group-body csv-marker-group-body-neutral"></span>`;
  }

  if (isImageMarkerValue(normalized)) {
    return `<span class="csv-marker-group-body"><img class="csv-marker-group-image" src="${escapeAttribute(resolveImageUrl(normalized))}" alt="" /></span>`;
  }

  return `<span class="csv-marker-group-body">${escapeHtml(normalized)}</span>`;
}

/**
 * Keep cluster counts compact enough to fit inside the small badge.
 */
function formatGroupedPointCount(count) {
  const parsed = Number(count);

  if (!Number.isFinite(parsed) || parsed < 1) return "1";
  if (parsed > 9999) return "9999+";

  return String(Math.floor(parsed));
}

/**
 * Create icon for marker value.
 * Returns null to use Leaflet default marker.
 */
export function getMarkerIcon(markerValue) {
  try {
    const normalized = String(markerValue ?? "").trim();

    if (!normalized) return null;

    if (iconCache.has(normalized)) {
      return iconCache.get(normalized);
    }

    const icon = isImageMarkerValue(normalized)
      ? createImageMarkerIcon(normalized)
      : createTextMarkerIcon(normalized);

    iconCache.set(normalized, icon);
    return icon;
  } catch {
    return null;
  }
}

/**
 * Public cluster icon factory used by GeoMap.
 * Icons are cached by marker value and count to avoid rebuilding divIcons repeatedly.
 */
export function getClusterMarkerIcon(markerValue, count) {
  try {
    const normalized = String(markerValue ?? "").trim();
    const safeCount = formatGroupedPointCount(count);
    const cacheKey = `${normalized}:${safeCount}`;

    if (clusterIconCache.has(cacheKey)) {
      return clusterIconCache.get(cacheKey);
    }

    const icon = createClusterMarkerIcon(normalized, safeCount);
    clusterIconCache.set(cacheKey, icon);
    return icon;
  } catch {
    return null;
  }
}
