import assert from "node:assert/strict";
import {
  DEFAULT_CLUSTER_RADIUS,
  MAX_CLUSTER_RADIUS,
  MIN_CLUSTER_RADIUS,
  getInitialMapToolsState,
  normalizeClusterRadius,
} from "./useMapToolsState.js";

assert.equal(MIN_CLUSTER_RADIUS, 0);
assert.equal(MAX_CLUSTER_RADIUS, 300);
assert.equal(DEFAULT_CLUSTER_RADIUS, 80);

assert.equal(normalizeClusterRadius("0", 80), 0);
assert.equal(normalizeClusterRadius("-1", 80), 0);
assert.equal(normalizeClusterRadius("300", 80), 300);
assert.equal(normalizeClusterRadius("301", 80), 300);
assert.equal(normalizeClusterRadius("12.9", 80), 12);
assert.equal(normalizeClusterRadius("", 42), 42);
assert.equal(normalizeClusterRadius("not-a-number", 42), 42);

const initialState = getInitialMapToolsState();
assert.equal(initialState.clusterMarkersEnabled, false);
assert.equal(initialState.clusterRadius, DEFAULT_CLUSTER_RADIUS);
assert.equal(initialState.clusterRadiusDraft, DEFAULT_CLUSTER_RADIUS);
assert.equal(initialState.zoneEditingEnabled, false);

console.log("Map tools state smoke checks passed.");
