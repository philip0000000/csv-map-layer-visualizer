"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CUSTOM_TILE_LAYERS_FILE_NAME = "custom-tile-layers.json";

/** Resolve the one application-owned file used for desktop custom tile definitions. */
function getCustomTileLayerFilePath(userDataPath) {
  return path.join(userDataPath, CUSTOM_TILE_LAYERS_FILE_NAME);
}

/** Read persisted definitions without exposing the file path or raw filesystem errors. */
function readCustomTileLayerFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, entries: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) return { ok: false, entries: [] };
    return { ok: true, entries: parsed };
  } catch {
    return { ok: false, entries: [] };
  }
}

/** Replace persisted definitions atomically so a failed write cannot leave partial JSON. */
function writeCustomTileLayerFile(filePath, entries) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    fs.renameSync(temporaryPath, filePath);
    return { ok: true };
  } catch {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // A cleanup failure must not expose or replace the persistence failure.
    }
    return { ok: false };
  }
}

module.exports = {
  getCustomTileLayerFilePath,
  readCustomTileLayerFile,
  writeCustomTileLayerFile,
};
