import L from "leaflet";

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|svg|webp|gif)$/i;
const DEFAULT_IMAGE_SIZE = [32, 32];
const DEFAULT_IMAGE_ANCHOR = [16, 32];
const DEFAULT_TEXT_ANCHOR = [0, 16];

const iconCache = new Map();
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
