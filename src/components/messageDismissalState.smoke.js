import assert from "node:assert/strict";
import {
  getParsingWarningsMessageKey,
  INITIAL_CONDITION_DISMISSAL,
  reduceConditionDismissal,
} from "./messageDismissalState.js";

let warningState = reduceConditionDismissal(
  INITIAL_CONDITION_DISMISSAL,
  { type: "sync", active: true },
);
warningState = reduceConditionDismissal(warningState, { type: "dismiss" });
assert.equal(warningState.dismissed, true);

warningState = reduceConditionDismissal(
  warningState,
  { type: "sync", active: true },
);
assert.equal(
  warningState.dismissed,
  true,
  "an active warning remains dismissed when only its count changes",
);

warningState = reduceConditionDismissal(
  warningState,
  { type: "sync", active: false },
);
warningState = reduceConditionDismissal(
  warningState,
  { type: "sync", active: true },
);
assert.equal(
  warningState.dismissed,
  false,
  "a resolved warning can appear when its condition occurs again",
);

assert.equal(
  getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "first" }),
  "dataset-a:first",
);
assert.notEqual(
  getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "first" }),
  getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "second" }),
  "reimported parsing results receive a new dismissal identity",
);
assert.notEqual(
  getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "first" }),
  getParsingWarningsMessageKey({ id: "dataset-b", importedAt: "first" }),
  "parsing-warning dismissal remains independent per CSV",
);

const dismissedParsingWarnings = new Set([
  getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "first" }),
]);
assert.equal(
  dismissedParsingWarnings.has(
    getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "first" }),
  ),
  true,
  "reselecting the same CSV preserves its parsing-warning dismissal",
);
assert.equal(
  dismissedParsingWarnings.has(
    getParsingWarningsMessageKey({ id: "dataset-b", importedAt: "first" }),
  ),
  false,
  "selecting a different CSV does not inherit another CSV's dismissal",
);
assert.equal(
  dismissedParsingWarnings.has(
    getParsingWarningsMessageKey({ id: "dataset-a", importedAt: "second" }),
  ),
  false,
  "new parsing results are not hidden by an earlier dismissal",
);

console.log("Message dismissal state smoke checks passed.");
