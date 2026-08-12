/** Start a fresh enabled period so a previously dismissed warning may appear again. */
export function enableCustomTileWarningPeriod(state, layerId) {
  return {
    ...state,
    [layerId]: { active: true, visible: false, dismissed: false },
  };
}

/** End an enabled period and discard its visible or dismissed warning state. */
export function disableCustomTileWarningPeriod(state, layerId) {
  if (!state[layerId]) return state;
  const next = { ...state };
  delete next[layerId];
  return next;
}

/** Show one warning only while the layer is active and has not been dismissed. */
export function reportCustomTileError(state, layerId) {
  const current = state[layerId];
  if (!current?.active || current.dismissed || current.visible) return state;
  return { ...state, [layerId]: { ...current, visible: true } };
}

/** Suppress repeated errors until this layer begins another enabled period. */
export function dismissCustomTileWarning(state, layerId) {
  const current = state[layerId];
  if (!current?.active) return state;
  return {
    ...state,
    [layerId]: { ...current, visible: false, dismissed: true },
  };
}
