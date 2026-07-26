import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import {
  createBrowserSqliteWorkerRuntime,
} from './browserSqliteWorkerRuntime.js';

const runtime = createBrowserSqliteWorkerRuntime({
  initializeSql: () => initSqlJs({
    locateFile: () => sqlWasmUrl,
  }),
  postMessage: (message) => self.postMessage(message),
});

self.addEventListener('message', (event) => {
  void runtime.handleMessage(event.data);
});
