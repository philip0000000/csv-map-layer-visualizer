/** Format a geographic distance with compact metric units. */
export function formatMetricDistance(distanceMeters) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(2)} km`;
}

/** Start a fresh two-point measurement at one geographic endpoint. */
export function startDistanceMeasurement(start) {
  return { start: { ...start }, end: null };
}

/** Place the second endpoint once and ignore later map clicks. */
export function completeDistanceMeasurement(measurement, end) {
  if (!measurement || measurement.end) return measurement;
  return { ...measurement, end: { ...end } };
}

/** Move one endpoint of a completed measurement while preserving the other. */
export function moveDistanceEndpoint(measurement, endpoint, position) {
  if (!measurement?.end || (endpoint !== "start" && endpoint !== "end")) {
    return measurement;
  }

  return { ...measurement, [endpoint]: { ...position } };
}

/** Cancel only a measurement that is still waiting for its second endpoint. */
export function cancelIncompleteDistanceMeasurement(measurement) {
  return measurement && !measurement.end ? null : measurement;
}

/** Clear the sole temporary measurement and all UI derived from it. */
export function clearDistanceMeasurement() {
  return null;
}
