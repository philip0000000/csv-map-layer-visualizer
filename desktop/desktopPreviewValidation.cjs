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

/** Identify stalled awaits in either process; the renderer receives this helper verbatim. */
async function validationStage(name, action, timeoutMs = 10000) {
  console.log(`[Preview validation] ${name}`);
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Preview validation stalled at: ${name}`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Exercise the real React app with a controlled desktop bridge and delayed responses. */
async function run() {
  const { createServer } = await validationStage('load Vite', () => import("vite"));
  server = await validationStage('create Vite server', () => createServer({
    root: path.resolve(__dirname, ".."), configFile: false, logLevel: "error",
    // Other dev servers and tests must never replace this run's optimized dependencies.
    cacheDir: path.join(temporaryProfile, 'vite-cache'),
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
        'leaflet', 'leaflet.markercluster', 'leaflet-polylinedecorator', 'react-leaflet',
        'react-leaflet-cluster', 'papaparse', 'sql.js/dist/sql-wasm-browser.js'],
    },
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
  }));
  await validationStage('listen on loopback', () => server.listen());
  window = new BrowserWindow({ show: false, width: 1100, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on('console-message', (event) => {
    if (event.message.startsWith('[Preview validation]') || event.level === 'error') {
      console.log(event.message);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    void finish(new Error(`Preview renderer exited: ${details.reason}`));
  });
  window.webContents.session.webRequest.onCompleted((details) => {
    if (details.statusCode >= 400) console.error(`Preview HTTP ${details.statusCode}: ${details.url}`);
  });
  // The test needs no external map tiles or network services.
  window.webContents.session.webRequest.onBeforeRequest((request, callback) => {
    callback({ cancel: !request.url.startsWith("http://127.0.0.1:")
      && !request.url.startsWith("ws://127.0.0.1:") && !request.url.startsWith("data:") });
  });
  await validationStage('load validation page', () => window.loadURL(
    `http://127.0.0.1:${server.httpServer.address().port}/__desktop_preview_validation`));
  await validationStage('install renderer diagnostics', () => window.webContents.executeJavaScript(
    `globalThis.validationStage = ${validationStage.toString()}; void 0;`));
  const result = await validationStage('Preview UI checks', () => window.webContents.executeJavaScript(
    `(${verifyPreview.toString()})()`), 20000);
  if (result !== "passed") throw new Error(String(result));
  await validationStage('browser SQLite integration', () => window.webContents.executeJavaScript(
    `(${verifyBrowserSearch.toString()})()`), 15000);
  await finish();
}

/** Verify real Preview/search controls, row actions, paging, and stale-response rejection. */
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
    getFeatureDetails: async ({ sourceRef }) => ({ row: rows[sourceRef.datasetId][sourceRef.rowIndex] }),
    getPreviewFeature: async ({ sourceRef }) => sourceRef.rowIndex === 0 ? { points: [{
      id: `${sourceRef.datasetId}:0`, lat: 59, lon: 18, sourceRef,
      timelineExtent: { startYear: 1200, endYear: 1200 },
    }] } : {},
    getSearchRows: async ({ datasetId, afterRowIndex = -1, rowIndices }) => {
      const indices = rowIndices ?? rows[datasetId].map((_, i) => i).filter((i) => i > afterRowIndex).slice(0, 201);
      const result = { rows: indices.slice(0, 200).map((i) => rows[datasetId][i]),
        sourceRowIndices: indices.slice(0, 200), hasMore: indices.length > 200 };
      if (hold) { hold = false; return new Promise((resolve) => { pending = () => resolve(result); }); }
      return result;
    },
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
  await globalThis.validationStage('import application', () => import("/src/main.jsx"));

  /** Bound every wait so a UI regression fails instead of hanging the run. */
  async function waitFor(check, message) {
    console.log(`[Preview validation] Checking: ${message}`);
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
  tableRows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  await waitFor(() => document.body.textContent.includes('This file is hidden on the map.'), 'Hidden-file explanation missing');
  if (!button('Highlight on map').disabled) throw new Error('Hidden file action enabled');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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

  // Exercise search through the real controls and production regex worker.
  const searchInput = document.querySelector('[aria-label="Search CSV values"]');
  const scopeInput = document.querySelector('[aria-label="Search scope"]');
  /** Use native setters so React observes programmatic input just like typing. */
  function inputValue(input, value) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
  /** Submit after React has rendered the new query. */
  async function search(text, scope = 'current') {
    inputValue(searchInput, text);
    inputValue(scopeInput, scope);
    await new Promise((resolve) => setTimeout(resolve, 30));
    button('Search').click();
    await waitFor(() => button('Clear search'), `Search did not finish: ${text}`);
  }
  await search('/A-/');
  if (!document.body.textContent.includes('65 matching rows in 1 files') || tableRows().length !== 30) {
    throw new Error('Current-file search count or initial page is wrong');
  }
  button('Show 30 more').click();
  await waitFor(() => tableRows().length === 60, 'Search page did not append');
  await search('/A-|B-/', 'all');
  if (!document.body.textContent.includes('67 matching rows in 2 files')) throw new Error('All-files search omitted hidden file');
  await search('/A-|B-/', 'shown');
  if (!document.body.textContent.includes('65 matching rows in 1 files')) throw new Error('Shown-files scope included hidden file');
  inputValue(searchInput, '/[/');
  await new Promise((resolve) => setTimeout(resolve, 30));
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  await waitFor(() => document.querySelector('.csvPanelBody [role="alert"]'), 'Invalid regex did not show inline error');
  inputValue(searchInput, 'A-');
  await new Promise((resolve) => setTimeout(resolve, 30));
  hold = true;
  button('Search').click();
  await waitFor(() => pending && button('Cancel'), 'Search cancellation was not available');
  button('Cancel').click();
  await release();
  if (button('Clear search') || searchInput.value !== 'A-') throw new Error('Cancelled search replaced Preview or lost query');
  await search('A-0');
  tableRows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  await waitFor(() => button('Highlight on map') && !button('Highlight on map').disabled, 'Search row could not be highlighted');
  button('Highlight on map').click();
  await waitFor(() => document.querySelector('[aria-label="Feature details"]'), 'Highlight did not open details');
  const viewButton = document.querySelector('[aria-label="View on map"]');
  if (!viewButton) throw new Error('View on map button missing');
  viewButton.click();
  await waitFor(() => !viewButton.disabled, 'View on map did not finish');
  if (document.querySelector('.markerDetailsPanelContent [role="alert"]')) throw new Error('View on map failed');
  document.querySelector('[aria-label="Collapse feature details"]').click();
  await waitFor(() => document.querySelector('.markerDetailsPanelHeader').hidden, 'Collapsed panel still shows navigation');
  document.querySelector('[aria-label="Expand feature details"]').click();
  await waitFor(() => !document.querySelector('.markerDetailsPanelHeader').hidden, 'Expanded panel hides navigation');
  document.querySelector('[aria-label="Close feature details"]').click();
  button('Clear search').click();
  await waitFor(() => tableRows().length === 30, 'Clear did not restore normal Preview');
  tableRows()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  await waitFor(() => document.body.textContent.includes('This row has no map feature.'), 'Non-feature row explanation missing');
  if (!button('Highlight on map').disabled) throw new Error('Non-feature row action enabled');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

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

/** Exercise the real browser SQLite worker and adapter with the same search implementation. */
async function verifyBrowserSearch() {
  const { createBrowserSqliteDataSource } = await globalThis.validationStage('import browser adapter',
    () => import('/src/data/browserSqlite/browserSqliteDataSource.js'));
  const { startPreviewSearch } = await globalThis.validationStage('import search module',
    () => import('/src/data/previewSearch.js'));
  const dataSource = createBrowserSqliteDataSource();
  /** Identify the failing stage rather than waiting for the whole validation deadline. */
  async function bounded(promise, stage) {
    return globalThis.validationStage(`browser ${stage}`, () => promise, 5000);
  }
  try {
    if (!(await bounded(dataSource.initialize(), 'initialization')).ok) throw new Error('Browser database initialization failed');
    const result = await bounded(dataSource.importBrowserFiles({ files: [new File([
      'name,lat,lon,featureType,featureId,order\nMatch,59,18,point,,\nMatch,,,point,,\nMatch,59,18,line,route,1\nMatch,60,19,line,route,2\n',
    ], 'search.csv', { type: 'text/csv' })] }), 'import');
    if (!result.ok) throw new Error('Browser search fixture import failed');
    const { datasets: files } = await bounded(dataSource.getDatasetSummary(), 'summary');
    const datasetId = files[0].id;
    const groups = await bounded(startPreviewSearch({ dataSource, files, text: '/match/i' }).promise, 'search');
    if (groups[0]?.totalRows !== 4 || groups[0].sourceRowIndices.join(',') !== '0,1,2,3') {
      throw new Error('Browser search lost rows or source identities');
    }
    const point = await bounded(dataSource.getPreviewFeature({ sourceRef: { datasetId, rowIndex: 0 } }), 'point lookup');
    const missing = await bounded(dataSource.getPreviewFeature({ sourceRef: { datasetId, rowIndex: 1 } }), 'missing feature lookup');
    const line = await bounded(dataSource.getPreviewFeature({ sourceRef: { datasetId, rowIndex: 3 } }), 'line lookup');
    if (point?.selectionKind !== 'point' || missing !== null || line?.selectionKind !== 'line'
      || line.sourceRef.rowIndex !== 2) throw new Error('Browser row-to-map resolution failed');
  } finally {
    await dataSource.dispose();
  }
}

/** Close the hidden test window and server even after a failure or timeout. */
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  (error ? process.stderr : process.stdout).write(error
    ? `${error.stack ?? error}\n` : "Desktop Preview UI validation passed.\n");
  if (window && !window.isDestroyed()) window.destroy();
  try {
    if (server) await validationStage('close Vite server', () => server.close(), 5000);
  } catch (cleanupError) {
    console.error(cleanupError.message);
    error ??= cleanupError;
  } finally { app.exit(error ? 1 : 0); }
}
