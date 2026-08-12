"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getCustomTileLayerFilePath,
  readCustomTileLayerFile,
  writeCustomTileLayerFile,
} = require("./customTileLayerStore.cjs");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "csv-map-tile-layers-"));
const filePath = getCustomTileLayerFilePath(temporaryDirectory);

try {
  assert.deepEqual(readCustomTileLayerFile(filePath), { ok: true, entries: [] });

  const entries = [{
    name: "Historical map",
    url: "https://tiles.example.com/{z}/{x}/{y}",
    attribution: "Example maps",
    maxZoom: 18,
    type: "background",
    creationOrder: 0,
  }];
  assert.deepEqual(writeCustomTileLayerFile(filePath, entries), { ok: true });
  assert.deepEqual(readCustomTileLayerFile(filePath), { ok: true, entries });
  const replacement = [{ ...entries[0], name: "Replacement", creationOrder: 1 }];
  assert.deepEqual(writeCustomTileLayerFile(filePath, replacement), { ok: true });
  assert.deepEqual(readCustomTileLayerFile(filePath), { ok: true, entries: replacement });

  fs.writeFileSync(filePath, "{ invalid JSON", "utf8");
  assert.deepEqual(readCustomTileLayerFile(filePath), { ok: false, entries: [] });

  fs.writeFileSync(filePath, JSON.stringify({ not: "an array" }), "utf8");
  assert.deepEqual(readCustomTileLayerFile(filePath), { ok: false, entries: [] });
} finally {
  // The exact test-owned temporary directory is safe to remove recursively.
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Desktop custom tile-layer persistence smoke checks passed.");
