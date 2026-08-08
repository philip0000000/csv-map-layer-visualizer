const DECIMAL_NUMBER_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const DECIMAL_NUMBER_PATTERN = new RegExp(`^${DECIMAL_NUMBER_SOURCE}$`);
const DECIMAL_PAIR_PATTERN = new RegExp(
  `^\\s*(${DECIMAL_NUMBER_SOURCE})\\s*[,;]\\s*(${DECIMAL_NUMBER_SOURCE})\\s*$`,
);
const DMS_PAIR_PATTERN = /^\s*(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]\s*([NS])\s+(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]\s*([EW])\s*$/i;

/** Format one finite coordinate with the map menu's required precision. */
function formatCoordinate(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6);
}

/** Format a latitude-longitude pair exactly as it should be copied. */
export function formatCoordinatePair(latitude, longitude) {
  return `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`;
}

/** Validate both coordinate fields without clamping either entered value. */
export function validateCoordinateInputs(latitudeText, longitudeText) {
  const latitude = validateCoordinate(latitudeText, "Latitude", -90, 90);
  const longitude = validateCoordinate(longitudeText, "Longitude", -180, 180);

  return {
    ok: !latitude.error && !longitude.error,
    latitude: latitude.value,
    longitude: longitude.value,
    errors: {
      latitude: latitude.error,
      longitude: longitude.error,
    },
  };
}

/** Recognize only complete supported decimal or Google Earth-style DMS pairs. */
export function parseCoordinatePaste(text) {
  if (typeof text !== "string" || /[\r\n]/.test(text)) return null;

  const decimalPair = parseDecimalPair(text);
  if (decimalPair) return decimalPair;

  return parseDmsPair(text);
}

/** Parse a complete decimal pair while preserving the entered numeric precision. */
function parseDecimalPair(text) {
  const match = DECIMAL_PAIR_PATTERN.exec(text);
  if (!match) return null;

  return {
    latitude: match[1],
    longitude: match[2],
  };
}

/** Convert one validated DMS coordinate to signed decimal degrees. */
function convertDmsCoordinate(degreesText, minutesText, secondsText, hemisphere) {
  const degrees = Number(degreesText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (minutes >= 60 || seconds >= 60) return null;

  // Hemisphere is the sole sign source for DMS input, avoiding ambiguous signed degrees.
  const sign = hemisphere === "S" || hemisphere === "W" ? -1 : 1;
  return sign * (degrees + (minutes / 60) + (seconds / 3600));
}

/** Parse a complete latitude-then-longitude Google Earth-style DMS pair. */
function parseDmsPair(text) {
  const match = DMS_PAIR_PATTERN.exec(text);
  if (!match) return null;

  const latitude = convertDmsCoordinate(match[1], match[2], match[3], match[4].toUpperCase());
  const longitude = convertDmsCoordinate(match[5], match[6], match[7], match[8].toUpperCase());
  if (
    latitude == null ||
    longitude == null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude: formatCoordinate(latitude),
    longitude: formatCoordinate(longitude),
  };
}

/** Validate one complete decimal field against its coordinate range. */
function validateCoordinate(text, label, minimum, maximum) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { value: null, error: `${label} is required.` };
  }
  if (!DECIMAL_NUMBER_PATTERN.test(trimmed)) {
    return { value: null, error: `${label} must be a decimal number.` };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    return {
      value: null,
      error: `${label} must be between ${minimum} and ${maximum}.`,
    };
  }

  return { value, error: null };
}
