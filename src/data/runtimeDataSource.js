import { createDesktopSqliteDataSource } from './desktopSqliteDataSource.js';
import { createBrowserSqliteDataSource } from './browserSqlite/browserSqliteDataSource.js';
import { createInMemoryDataSource } from './inMemoryDataSource.js';

export const BROWSER_BACKENDS = Object.freeze({
  RAW: 'raw',
  SQLITE: 'sqlite',
});

/**
 * Select exactly one backend for the current page session.
 * Runtime detection stays here so presentation components receive a contract
 * implementation and capabilities instead of Electron bridge details.
 */
export function selectRuntimeDataSource({
  desktopApi,
  browserBackend = BROWSER_BACKENDS.RAW,
  onBrowserStateChange,
  createBrowserSqlite = createBrowserSqliteDataSource,
} = {}) {
  const isDesktop = desktopApi?.isDesktop === true;
  const selectedBrowserBackend = browserBackend === BROWSER_BACKENDS.SQLITE
    ? BROWSER_BACKENDS.SQLITE
    : BROWSER_BACKENDS.RAW;
  const dataSource = isDesktop
    ? createDesktopSqliteDataSource({ desktopApi })
    : selectedBrowserBackend === BROWSER_BACKENDS.SQLITE
      ? createBrowserSqlite()
      : createInMemoryDataSource({ onStateChange: onBrowserStateChange });
  const runtime = isDesktop
    ? 'desktop'
    : selectedBrowserBackend === BROWSER_BACKENDS.SQLITE
      ? 'browser-sqlite'
      : 'browser';

  return Object.freeze({
    runtime,
    isDesktop,
    browserBackend: isDesktop ? null : selectedBrowserBackend,
    dataSource,
    capabilities: dataSource.getCapabilities(),
  });
}
