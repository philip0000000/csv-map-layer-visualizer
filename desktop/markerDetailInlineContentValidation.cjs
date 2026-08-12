"use strict";

const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const VALIDATION_TIMEOUT_MS = 30_000;
const projectRoot = path.resolve(__dirname, "..");
let viteServer = null;
let window = null;
let finished = false;

app.disableHardwareAcceleration();

app.whenReady().then(run).catch((error) => {
  void finish({
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
  });
});

/** Run interactive renderer checks in a hidden, sandboxed Electron window. */
async function run() {
  const { createServer } = await import("vite");
  viteServer = await createServer({
    root: projectRoot,
    configFile: path.join(projectRoot, "vite.config.js"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await viteServer.listen();
  const address = viteServer.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("The validation server did not expose a local port.");
  }

  window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(
    `http://127.0.0.1:${address.port}/marker-detail-inline-validation.html`,
  );

  const timeout = setTimeout(() => {
    void finish({
      status: "failed",
      message: `Marker-detail validation exceeded ${VALIDATION_TIMEOUT_MS} ms.`,
    });
  }, VALIDATION_TIMEOUT_MS);
  const poll = setInterval(async () => {
    if (finished || window?.isDestroyed()) return;
    const result = await window.webContents.executeJavaScript(
      "globalThis.__markerDetailInlineValidationResult ?? null",
      true,
    );
    if (!result) return;

    clearInterval(poll);
    clearTimeout(timeout);
    await finish(result);
  }, 50);
}

async function finish(result) {
  if (finished) return;
  finished = true;
  const passed = result?.status === "passed";
  (passed ? process.stdout : process.stderr).write(`${JSON.stringify(result)}\n`);
  if (window && !window.isDestroyed()) window.destroy();
  if (viteServer) await viteServer.close();
  app.exit(passed ? 0 : 1);
}
