import assert from "node:assert/strict";
import { commitTimelineYear, parseWholeYear } from "./timelineYearRange.js";

const range = { yearMin: -2100, yearMax: 2026, startYear: 504, endYear: 505 };

// Crossing in either direction pushes the other edge, including a single-year range.
for (const [boundary, value, expected] of [
  ["startYear", "505", { startYear: 505, endYear: 505 }],
  ["startYear", "506", { startYear: 506, endYear: 506 }],
  ["endYear", "504", { startYear: 504, endYear: 504 }],
  ["endYear", "503", { startYear: 503, endYear: 503 }],
  ["startYear", "500", { startYear: 500, endYear: 505 }],
  ["endYear", "510", { startYear: 504, endYear: 510 }],
  ["startYear", "3000", { startYear: 2026, endYear: 2026 }],
  ["endYear", "-3000", { startYear: -2100, endYear: -2100 }],
  ["startYear", "-3000", { startYear: -2100, endYear: 505 }],
  ["endYear", "3000", { startYear: 504, endYear: 2026 }],
]) {
  assert.deepEqual(commitTimelineYear(range, boundary, value), expected);
}

for (const text of ["", " ", "-", "abc", "505.5", "505.0", "1e3", "505x", "9007199254740992"]) {
  assert.equal(parseWholeYear(text), null);
  assert.equal(commitTimelineYear(range, "startYear", text), null);
}
assert.equal(parseWholeYear(" -504 "), -504);
assert.equal(parseWholeYear("0"), 0);

// Empty edges saved by the old inputs must not block a valid replacement.
for (const [saved, boundary, text, expected] of [
  [{ startYear: null }, "startYear", "504", { startYear: 504, endYear: 505 }],
  [{ endYear: null }, "endYear", "505", { startYear: 504, endYear: 505 }],
  [{ startYear: null }, "endYear", "506", { startYear: -2100, endYear: 506 }],
  [{ endYear: null }, "startYear", "503", { startYear: 503, endYear: 2026 }],
  [{ startYear: null, endYear: null }, "startYear", "504", { startYear: 504, endYear: 2026 }],
  [{ startYear: null, endYear: null }, "endYear", "505", { startYear: -2100, endYear: 505 }],
  [{ startYear: null }, "startYear", "506", { startYear: 506, endYear: 506 }],
  [{ endYear: null }, "endYear", "503", { startYear: 503, endYear: 503 }],
  [{ startYear: null, endYear: null }, "startYear", "3000", { startYear: 2026, endYear: 2026 }],
  [{ startYear: null, endYear: null }, "endYear", "-3000", { startYear: -2100, endYear: -2100 }],
]) {
  assert.deepEqual(commitTimelineYear({ ...range, ...saved }, boundary, text), expected);
}
assert.equal(commitTimelineYear({ ...range, startYear: null }, "startYear", ""), null);
assert.equal(commitTimelineYear({ ...range, yearMin: null }, "startYear", "504"), null);

// Repeated forward/backward steps remain ordered and stop at domain limits.
let selection = { ...range };
for (let year = 505; year <= 2030; year += 1) {
  selection = { ...selection, ...commitTimelineYear(selection, "startYear", year) };
  assert.equal(selection.startYear, Math.min(2026, year));
  assert.equal(selection.endYear, selection.startYear);
}
for (let year = 2025; year >= -2105; year -= 1) {
  selection = { ...selection, ...commitTimelineYear(selection, "endYear", year) };
  assert.equal(selection.endYear, Math.max(-2100, year));
  assert.equal(selection.startYear, selection.endYear);
}

const singleYear = { yearMin: 505, yearMax: 505, startYear: 505, endYear: 505 };
for (const boundary of ["startYear", "endYear"]) {
  for (const year of [504, 505, 506]) {
    assert.deepEqual(commitTimelineYear(singleYear, boundary, year), { startYear: 505, endYear: 505 });
  }
}
console.log("Timeline year input smoke checks passed.");
