"use strict";

/** Return true only for absolute HTTP(S) URLs allowed to leave the desktop app. */
function isSafeExternalLinkUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Build Electron's new-window handler with a fixed external-browser policy.
 * Every in-app window is denied, including requests with unsupported schemes.
 */
function createExternalLinkWindowHandler(openExternal) {
  return ({ url }) => {
    if (isSafeExternalLinkUrl(url)) {
      try {
        const opening = openExternal(url);
        if (typeof opening?.catch === "function") opening.catch(() => {});
      } catch {
        // A platform browser-launch failure must not navigate the map window.
      }
    }

    return { action: "deny" };
  };
}

module.exports = {
  createExternalLinkWindowHandler,
  isSafeExternalLinkUrl,
};
