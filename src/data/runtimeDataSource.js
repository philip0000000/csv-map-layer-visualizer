import { createDesktopSqliteDataSource } from './desktopSqliteDataSource.js';
import { createBrowserSqliteDataSource } from './browserSqlite/browserSqliteDataSource.js';

/**
 * Select exactly one SQLite backend for the current page session.
 *
 * Electron receives the persistent native adapter. Every browser, including
 * GitHub Pages, receives a fresh temporary SQLite WASM adapter. Keeping this
 * decision at the runtime boundary prevents presentation code from switching
 * backends or mixing datasets after a session starts.
 */
export function selectRuntimeDataSource({
  desktopApi,
  createBrowserSqlite = createBrowserSqliteDataSource,
} = {}) {
  const isDesktop = desktopApi?.isDesktop === true;
  const dataSource = isDesktop
    ? createDesktopSqliteDataSource({ desktopApi })
    : createBrowserSqlite();

  return Object.freeze({
    runtime: isDesktop ? 'desktop' : 'browser',
    isDesktop,
    dataSource,
    capabilities: dataSource.getCapabilities(),
  });
}
