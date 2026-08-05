export const INITIAL_CONDITION_DISMISSAL = Object.freeze({
  active: false,
  dismissed: false,
});

/** Track dismissal for one warning condition until that condition fully resolves. */
export function reduceConditionDismissal(state, action) {
  if (action.type === "dismiss") {
    return { active: true, dismissed: true };
  }

  if (action.type !== "sync") return state;
  if (!action.active) return INITIAL_CONDITION_DISMISSAL;
  if (state.active) return state;
  return { active: true, dismissed: false };
}

/** Identify one CSV's parsing results without relying on its display name. */
export function getParsingWarningsMessageKey(file) {
  if (!file?.id) return null;
  return `${file.id}:${file.importedAt ?? ""}`;
}
