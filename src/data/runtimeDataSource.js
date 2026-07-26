import { createDesktopSqliteDataSource } from './desktopSqliteDataSource.js';
import { createInMemoryDataSource } from './inMemoryDataSource.js';

/**
 * Select exactly one backend for the current page session.
 * Runtime detection stays here so presentation components receive a contract
 * implementation and capabilities instead of Electron bridge details.
 */
export function selectRuntimeDataSource({ desktopApi, onBrowserStateChange } = {}) {
  const isDesktop = desktopApi?.isDesktop === true;
  const dataSource = isDesktop
    ? createDesktopSqliteDataSource({ desktopApi })
    : createInMemoryDataSource({ onStateChange: onBrowserStateChange });

  return Object.freeze({
    runtime: isDesktop ? 'desktop' : 'browser',
    isDesktop,
    dataSource,
    capabilities: dataSource.getCapabilities(),
  });
}
