"use strict";

const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const VALIDATION_TIMEOUT_MS = 120_000;
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

async function run() {
  const { createServer } = await import("vite");
  viteServer = await createServer({
    root: projectRoot,
    configFile: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
    worker: { format: "es" },
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
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") {
      process.stderr.write(`Browser validation console: ${event.message}\n`);
    }
  });
  await window.loadURL(
    `http://127.0.0.1:${address.port}/browser-sqlite-worker-validation.html`,
  );

  const timeout = setTimeout(() => {
    void finish({
      status: "failed",
      message: `Real browser worker validation exceeded ${VALIDATION_TIMEOUT_MS} ms.`,
    });
  }, VALIDATION_TIMEOUT_MS);
  let polling = false;
  const poll = setInterval(async () => {
    if (polling || finished || window?.isDestroyed()) return;
    polling = true;
    try {
      const result = await window.webContents.executeJavaScript(
        "globalThis.__browserSqliteValidationResult ?? null",
        true,
      );
      if (result) {
        clearInterval(poll);
        clearTimeout(timeout);
        await finish(result);
      }
    } catch (error) {
      clearInterval(poll);
      clearTimeout(timeout);
      await finish({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      polling = false;
    }
  }, 100);
}

async function finish(result) {
  if (finished) return;
  finished = true;
  const passed = result?.status === "passed";
  const output = passed
    ? result
    : {
        status: "failed",
        message: typeof result?.message === "string"
          ? result.message
          : "Real browser worker validation failed.",
      };
  (passed ? process.stdout : process.stderr).write(
    `${JSON.stringify(output, null, 2)}\n`,
  );

  if (window && !window.isDestroyed()) window.destroy();
  if (viteServer) await viteServer.close();
  app.exit(passed ? 0 : 1);
}
