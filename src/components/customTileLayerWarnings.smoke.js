import assert from "node:assert/strict";
import {
  disableCustomTileWarningPeriod,
  dismissCustomTileWarning,
  enableCustomTileWarningPeriod,
  reportCustomTileError,
} from "./customTileLayerWarnings.js";

let state = {};
assert.equal(reportCustomTileError(state, "historical"), state);

state = enableCustomTileWarningPeriod(state, "historical");
state = reportCustomTileError(state, "historical");
assert.equal(state.historical.visible, true);
assert.equal(reportCustomTileError(state, "historical"), state);

state = dismissCustomTileWarning(state, "historical");
assert.deepEqual(state.historical, { active: true, visible: false, dismissed: true });
assert.equal(reportCustomTileError(state, "historical"), state);

state = disableCustomTileWarningPeriod(state, "historical");
assert.equal(state.historical, undefined);
assert.equal(reportCustomTileError(state, "historical"), state);

state = enableCustomTileWarningPeriod(state, "historical");
state = reportCustomTileError(state, "historical");
assert.equal(state.historical.visible, true);

console.log("Custom tile-layer warning smoke checks passed.");
