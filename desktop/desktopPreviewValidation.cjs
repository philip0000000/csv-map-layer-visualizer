"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

/** Own the temporary profile outside Electron so Windows releases its locks before cleanup. */
function runWithTemporaryProfile() {
  const { spawnSync } = require("node:child_process");
  const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), "csv-preview-ui-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = spawnSync(require("electron"), [__filename, temporaryProfile], {
      env, stdio: "inherit", windowsHide: true, timeout: 60000,
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    // Delete only the directory this invocation created, after the child exits.
    fs.rmSync(temporaryProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (!process.versions.electron) process.exit(runWithTemporaryProfile());

const { app, BrowserWindow } = require("electron");

const temporaryProfile = process.argv[2];
if (!temporaryProfile) throw new Error("Run this validation with Node so its temporary profile is cleaned up.");
app.setPath("userData", temporaryProfile);
app.disableHardwareAcceleration();
let server;
let window;
let finished = false;
const deadline = setTimeout(() => finish(new Error("Desktop Preview validation exceeded 45 seconds.")), 45000);

app.whenReady().then(run).catch(finish);

/** Exercise the real React app with a controlled desktop bridge and delayed responses. */
async function run() {
  const { createServer } = await import("vite");
  server = await createServer({
    root: path.resolve(__dirname, ".."), configFile: false, logLevel: "error",
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "desktop-preview-validation",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== "/__desktop_preview_validation") return next();
          response.setHeader("Content-Type", "text/html");
          response.end('<html><body><div id="root"></div></body></html>');
        });
      },
    }],
  });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1100, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  // The test needs no external map tiles or network services.
  window.webContents.session.webRequest.onBeforeRequest((request, callback) => {
    callback({ cancel: !request.url.startsWith("http://127.0.0.1:")
      && !request.url.startsWith("ws://127.0.0.1:") && !request.url.startsWith("data:") });
  });
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__desktop_preview_validation`);
  const result = await window.webContents.executeJavaScript(`(${verifyPreview.toString()})()`);
  if (result !== "passed") throw new Error(String(result));
  await finish();
}

/** Verify real UI paging, same-file clicks, failures, visibility, and stale-response rejection. */
async function verifyPreview() {
  const rows = {
    a: Array.from({ length: 65 }, (_, i) => ({ name: `A-${i}` })),
    b: [{ name: "B-hidden" }, { name: "B-second" }],
  };
  let datasets = [
    { id: "a", name: "a.csv", enabled: true, headers: ["name"], rowCount: 65, totalRows: 65,
      importedFeatureCount: 0, missingSourceRowCount: 0 },
    { id: "b", name: "b.csv", enabled: false, headers: ["name"], rowCount: 2, totalRows: 2,
      missingSourceRowCount: 3 },
  ];
  let hold = false;
  let fail = false;
  let pending = null;
  const requests = [];
  globalThis.confirm = () => true;
  globalThis.csvMapDesktop = {
    isDesktop: true,
    getStatus: async () => ({ ok: true }),
    getDatasetSummary: async () => ({ datasets }),
    queryMapView: async () => ({ points: [], lines: [], regions: [] }),
    getGroupRows: async () => ({ rows: [] }),
    getPreviewPage: async (query) => {
      requests.push(query);
      if (fail) { fail = false; throw new Error("Preview failure"); }
      const result = { ...query,
        rows: rows[query.datasetId].slice(query.offset, query.offset + query.limit),
        totalRows: rows[query.datasetId].length,
      };
      if (hold) { hold = false; return new Promise((resolve) => { pending = () => resolve(result); }); }
      return result;
    },
    setDatasetEnabled: async (id, enabled) => {
      datasets = datasets.map((item) => item.id === id ? { ...item, enabled } : item);
      return { updated: true };
    },
    removeDataset: async (id) => {
      datasets = datasets.filter((item) => item.id !== id);
      return { removed: true };
    },
  };
  await import("/src/main.jsx");

  /** Bound every wait so a UI regression fails instead of hanging the run. */
  async function waitFor(check, message) {
    const end = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > end) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  /** Find a rendered action by its exact user-visible text. */
  function button(text) {
    return [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
  }
  /** Read only the Preview table, excluding file metadata and controls. */
  function tableRows() { return [...document.querySelectorAll(".csvTable tbody tr")]; }
  /** Flush work after releasing an obsolete request before checking the current file. */
  async function release() {
    pending(); pending = null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await waitFor(() => tableRows().length === 30, "Initial 30 desktop rows did not load");
  if (button("a.csv").closest('[role="listitem"]').querySelector(".csvFileRows").textContent !== "65") {
    throw new Error("File list used feature count or the loaded page size instead of retained rows");
  }
  button("Show 30 more").click();
  await waitFor(() => tableRows().length === 60, "Second page did not append");
  button("Show 30 more").click();
  await waitFor(() => tableRows().length === 65 && !button("Show 30 more"), "Final partial page failed");
  if (requests.some((query) => query.limit !== 30)) throw new Error("UI requested an unbounded page");

  button("b.csv").click();
  await waitFor(() => tableRows()[0]?.textContent === "B-hidden", "Hidden file selection failed");
  if (datasets[1].enabled) throw new Error("Selection changed visibility");
  if (!document.body.textContent.includes("3 row(s) were discarded")) throw new Error("Missing legacy notice");
  if (document.querySelector('[aria-label="Select latitude field"]')) throw new Error("Desktop mapping controls exposed");

  hold = true;
  button("a.csv").click();
  await waitFor(() => pending, "Delayed first page was not requested");
  button("a.csv").click();
  await release();
  await waitFor(() => tableRows().length === 30, "Same-file click stranded the first-page request");

  hold = true;
  button("Show 30 more").click();
  await waitFor(() => pending, "Delayed append was not requested");
  button("b.csv").click();
  await waitFor(() => tableRows()[0]?.textContent === "B-hidden", "Switch during append failed");
  await release();
  if (tableRows().length !== 2 || tableRows()[0].textContent !== "B-hidden") throw new Error("Stale append replaced selection");

  fail = true;
  button("a.csv").click();
  await waitFor(() => document.querySelector('.csvPanelBody [role="alert"]'), "Preview error was not shown");
  button("b.csv").click();
  await waitFor(() => tableRows().length === 2, "Could not leave failed Preview");
  button("a.csv").click();
  await waitFor(() => tableRows().length === 30, "Could not reload Preview after error");

  hold = true;
  button("Show 30 more").click();
  await waitFor(() => pending, "Removal test did not start append");
  button("a.csv").closest('[role="listitem"]').querySelector(".csvBtnTiny").click();
  await waitFor(() => !button("a.csv") && tableRows()[0]?.textContent === "B-hidden", "Removal did not select surviving file");
  await release();
  if (tableRows().length !== 2) throw new Error("Removed file's page reappeared");
  button("b.csv").closest('[role="listitem"]').querySelector(".csvBtnTiny").click();
  await waitFor(() => !button("b.csv") && tableRows().length === 0, "Final removal did not clear Preview");
  return "passed";
}

/** Close the hidden test window and server even after a failure or timeout. */
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  (error ? process.stderr : process.stdout).write(error
    ? `${error.stack ?? error}\n` : "Desktop Preview UI validation passed.\n");
  if (window && !window.isDestroyed()) window.destroy();
  if (server) await server.close();
  app.exit(error ? 1 : 0);
}
