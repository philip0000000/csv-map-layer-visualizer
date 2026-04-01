import L from "leaflet";

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|svg|webp|gif)$/i;
const iconCache = new Map();
const defaultIcon = new L.Icon.Default();

/**
 * Return Leaflet icon for one marker value.
 * Returns null for empty values or when default marker should be used.
 */
export function getMarkerIcon(markerValue) {
  const normalized = normalizeMarkerValue(markerValue);
  if (!normalized) return null;

  if (iconCache.has(normalized)) {
    return iconCache.get(normalized);
  }

  const icon = createMarkerIcon(normalized);
  iconCache.set(normalized, icon);
  return icon;
}

function createMarkerIcon(value) {
  try {
    if (isImageMarker(value)) {
      return createImageIcon(resolveImageUrl(value));
    }

    return createTextIcon(value);
  } catch {
    return null;
  }
}

function normalizeMarkerValue(value) {
  if (value == null) return "";
  return String(value).trim();
}

function isImageMarker(value) {
  if (value.startsWith("/")) return true;
  if (value.startsWith("http://") || value.startsWith("https://")) return true;
  return IMAGE_EXTENSION_RE.test(value);
}

function resolveImageUrl(value) {
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `/icons/${value}`;
}

function createTextIcon(text) {
  const element = document.createElement("span");
  element.textContent = text;

  return L.divIcon({
    html: element,
    className: "csv-marker-text-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function createImageIcon(iconUrl) {
  const imageIcon = L.icon({
    iconUrl,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });

  const baseCreateIcon = imageIcon.createIcon;

  // If image fails, switch to default marker icon.
  imageIcon.createIcon = function patchedCreateIcon(oldIcon) {
    const element = baseCreateIcon.call(this, oldIcon);

    if (element && typeof element.addEventListener === "function") {
      element.addEventListener(
        "error",
        () => {
          try {
            defaultIcon.createIcon(element);
          } catch {
            // Keep the broken image if fallback fails.
          }
        },
        { once: true }
      );
    }

    return element;
  };

  return imageIcon;
}
