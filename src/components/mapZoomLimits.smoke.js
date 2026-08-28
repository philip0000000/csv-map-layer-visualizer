import assert from "node:assert/strict";

import {
  FALLBACK_MAP_MAX_ZOOM,
  getEffectiveMapMaxZoom,
} from "./mapZoomLimits.js";

assert.equal(FALLBACK_MAP_MAX_ZOOM, 20);

// Blank and unconfigured custom backgrounds both expose a missing configured limit.
for (const configuredMaxZoom of [null, undefined, Infinity]) {
  assert.equal(getEffectiveMapMaxZoom(configuredMaxZoom), FALLBACK_MAP_MAX_ZOOM);
}

// Preserve finite limits from built-in and custom tile backgrounds, including zero.
for (const configuredMaxZoom of [0, 19, 20, 24]) {
  assert.equal(getEffectiveMapMaxZoom(configuredMaxZoom), configuredMaxZoom);
}

console.log("map zoom limit smoke checks passed");
