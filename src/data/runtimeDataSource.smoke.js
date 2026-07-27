import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const { selectRuntimeDataSource } = await vite.ssrLoadModule(
    '/src/data/runtimeDataSource.js',
  );

  let browserStateChanges = 0;
  const browser = selectRuntimeDataSource({
    desktopApi: null,
    onBrowserStateChange: () => {
      browserStateChanges += 1;
    },
  });
  assert.equal(browser.runtime, 'browser');
  assert.equal(browser.isDesktop, false);
  assert.equal(browser.capabilities.persistence, 'temporary');
  assert.equal(browser.capabilities.browserFileImport, true);
  assert.equal(browser.capabilities.nativeFilePickerImport, false);
  assert.equal(browser.dataSource.initialize().ok, true);
  browser.dataSource.selectDataset(null);
  assert.equal(browserStateChanges, 1);

  let browserSqliteCreations = 0;
  const sqliteCapabilities = {
    ...browser.capabilities,
    groupedViewportResults: true,
  };
  const browserSqliteDataSource = {
    getCapabilities: () => sqliteCapabilities,
    initialize: async () => ({
      ok: true,
      capabilities: sqliteCapabilities,
      error: null,
    }),
    dispose: () => {},
  };
  const browserSqlite = selectRuntimeDataSource({
    desktopApi: null,
    browserBackend: 'sqlite',
    createBrowserSqlite: () => {
      browserSqliteCreations += 1;
      return browserSqliteDataSource;
    },
  });
  assert.equal(browserSqlite.runtime, 'browser-sqlite');
  assert.equal(browserSqlite.browserBackend, 'sqlite');
  assert.equal(browserSqlite.dataSource, browserSqliteDataSource);
  assert.equal(browserSqliteCreations, 1);
  assert.equal((await browserSqlite.dataSource.initialize()).ok, true);

  const desktopApi = {
    isDesktop: true,
    getStatus: async () => ({ ok: true }),
    importCsvToSqlite: async () => ({ canceled: true }),
    importDroppedCsvFiles: async () => ({ results: [] }),
    onCsvImportProgress: () => () => {},
    getDatasetSummary: async () => ({ datasets: [] }),
    setDatasetEnabled: async () => ({ updated: false }),
    removeDataset: async () => ({ removed: false }),
    queryMapView: async () => ({}),
    getFeatureDetails: async () => ({}),
    getGroupRows: async () => ({}),
  };
  const desktop = selectRuntimeDataSource({ desktopApi });
  assert.equal(desktop.runtime, 'desktop');
  assert.equal(desktop.isDesktop, true);
  assert.equal(desktop.capabilities.persistence, 'persistent');
  assert.equal(desktop.capabilities.browserFileImport, false);
  assert.equal(desktop.capabilities.nativeFilePickerImport, true);
  assert.equal((await desktop.dataSource.initialize()).ok, true);

  browser.dataSource.dispose();
  browserSqlite.dataSource.dispose();
  desktop.dataSource.dispose();
  console.log('Runtime DataSource selection smoke test passed.');
} finally {
  await vite.close();
}
