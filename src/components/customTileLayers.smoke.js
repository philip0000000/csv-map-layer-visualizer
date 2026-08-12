import assert from "node:assert/strict";
import {
  createCustomTileLayer,
  escapeLeafletText,
  normalizePersistedCustomTileLayers,
  validateCustomTileLayerInput,
} from "./customTileLayers.js";

function validInput(overrides = {}) {
  return {
    name: "Historical map",
    url: "https://tiles.example.com/{z}/{x}/{y}",
    attribution: "Example maps",
    maxZoom: "18",
    type: "background",
    ...overrides,
  };
}

for (const url of [
  "https://tiles.example.com/{z}/{x}/{y}",
  "https://tiles.example.com/{z}/{y}/{x}",
  "https://{s}.example.com/{z}/{x}/{y}@{r}",
  "https://tiles.example.com/render?row={y}&column={x}&zoom={z}",
  "http://localhost:8080/{z}/{x}/{y}",
  "http://127.0.0.1/{z}/{x}/{y}",
  "http://[::1]/{z}/{x}/{y}",
]) {
  assert.equal(validateCustomTileLayerInput(validInput({ url })).ok, true, url);
}

for (const [url, expectedError] of [
  ["", "Enter a tile URL."],
  ["https://tiles.example.com/{z}/{x}", "Tile URL must include {y}."],
  ["https://tiles.example.com/{Z}/{x}/{y}", "Unsupported placeholder {Z}"],
  ["https://tiles.example.com/{z}/{x}/{y}/{q}", "Unsupported placeholder {q}"],
  ["https://tiles.example.com/{z}/{x}/{y", "malformed placeholder"],
  ["http://tiles.example.com/{z}/{x}/{y}", "Remote HTTP"],
  ["http://localhost.example.com/{z}/{x}/{y}", "Remote HTTP"],
  ["ftp://localhost/{z}/{x}/{y}", "Use HTTPS"],
  ["https://user:secret@example.com/{z}/{x}/{y}", "Remove the username"],
]) {
  const result = validateCustomTileLayerInput(validInput({ url }));
  assert.equal(result.ok, false, url);
  assert.match(result.errors.url, new RegExp(expectedError.replace(/[{}]/g, "\\$&")), url);
}

assert.equal(validateCustomTileLayerInput(validInput({ name: "   " })).ok, false);
assert.equal(validateCustomTileLayerInput(validInput(), {
  existingNames: [" historical MAP "],
}).ok, false);
assert.equal(validateCustomTileLayerInput(validInput({ name: "Normal (OSM)" })).ok, false);

for (const maxZoom of ["-1", "1.5", "1e2", "Infinity", "9007199254740992"]) {
  const result = validateCustomTileLayerInput(validInput({ maxZoom }));
  assert.equal(result.ok, false, maxZoom);
  assert.ok(result.errors.maxZoom, maxZoom);
}
assert.equal(validateCustomTileLayerInput(validInput({ maxZoom: "" })).value.maxZoom, null);
assert.equal(validateCustomTileLayerInput(validInput({ maxZoom: "0" })).value.maxZoom, 0);

const created = createCustomTileLayer(validInput({ name: "  Historical map  " }), {
  creationOrder: 4,
});
assert.equal(created.ok, true);
assert.deepEqual(created.value, {
  name: "Historical map",
  url: "https://tiles.example.com/{z}/{x}/{y}",
  attribution: "Example maps",
  maxZoom: 18,
  type: "background",
  id: "custom:historical map",
  creationOrder: 4,
});

// Valid names resembling built-in state identifiers must retain distinct runtime IDs.
for (const name of ["osm", "blank", "satellite"]) {
  const result = createCustomTileLayer(validInput({ name }), { creationOrder: 0 });
  assert.equal(result.ok, true, name);
  assert.equal(result.value.id, `custom:${name}`, name);
}

assert.deepEqual(
  normalizePersistedCustomTileLayers([
    { ...validInput({ name: "Second", maxZoom: null }), creationOrder: 2 },
    { ...validInput({ name: "First", maxZoom: null }), creationOrder: 1 },
    { ...validInput({ name: "FIRST", maxZoom: null }), creationOrder: 3 },
    { ...validInput({ name: "Invalid", url: "http://remote.test/{z}/{x}/{y}" }), creationOrder: 4 },
  ]).map(({ name, creationOrder }) => ({ name, creationOrder })),
  [
    { name: "First", creationOrder: 1 },
    { name: "Second", creationOrder: 2 },
  ],
);

assert.equal(
  escapeLeafletText(`<img src=x onerror="bad()"> Tom & Jerry's`),
  "&lt;img src=x onerror=&quot;bad()&quot;&gt; Tom &amp; Jerry&#39;s",
);

console.log("Custom tile-layer validation smoke checks passed.");
