import assert from "node:assert/strict";
import {
  cancelIncompleteDistanceMeasurement,
  clearDistanceMeasurement,
  completeDistanceMeasurement,
  formatMetricDistance,
  moveDistanceEndpoint,
  startDistanceMeasurement,
} from "./distanceMeasurement.js";

assert.equal(formatMetricDistance(0), "0 m");
assert.equal(formatMetricDistance(849.6), "850 m");
assert.equal(formatMetricDistance(999.4), "999 m");
assert.equal(formatMetricDistance(1000), "1.00 km");
assert.equal(formatMetricDistance(23750), "23.75 km");
assert.equal(formatMetricDistance(2252290), "2252.29 km");

const firstStart = { lat: 59.3293, lng: 18.0686 };
const replacementStart = { lat: 57.7089, lng: 11.9746 };
const end = { lat: 55.605, lng: 13.0038 };

const unfinished = startDistanceMeasurement(firstStart);
assert.deepEqual(unfinished, { start: firstStart, end: null });
assert.notEqual(unfinished.start, firstStart);

const replacement = startDistanceMeasurement(replacementStart);
assert.deepEqual(replacement, { start: replacementStart, end: null });

const completed = completeDistanceMeasurement(replacement, end);
assert.deepEqual(completed, { start: replacementStart, end });
assert.strictEqual(
  completeDistanceMeasurement(completed, firstStart),
  completed,
);

const movedStart = moveDistanceEndpoint(completed, "start", firstStart);
assert.deepEqual(movedStart, { start: firstStart, end });
assert.deepEqual(moveDistanceEndpoint(movedStart, "end", replacementStart), {
  start: firstStart,
  end: replacementStart,
});

assert.equal(cancelIncompleteDistanceMeasurement(unfinished), null);
assert.strictEqual(cancelIncompleteDistanceMeasurement(completed), completed);
assert.equal(clearDistanceMeasurement(), null);

console.log("Distance measurement smoke checks passed.");
