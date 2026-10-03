"use strict";
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
let server;
let window;
app.disableHardwareAcceleration();
app.whenReady().then(run).catch((error) => finish({ status: 'failed', message: error.message }));

/** Host the browser-rendered heat fixture in a sandboxed Electron renderer. */
async function run() {
  const { createServer } = await import('vite');
  server = await createServer({ root: path.resolve(__dirname, '..'), logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1100, height: 750,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/heatmap-validation.html`);
  const start = Date.now();
  let captured = false;
  while (Date.now() - start < 30000) {
    if (!captured && await window.webContents.executeJavaScript('globalThis.__heatmapVisualReady === true')) {
      // Canvas pixels update before Chromium composites the next screenshot frame.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const screenshot = path.join(os.tmpdir(), 'issue-165-heatmap-validation.png');
      fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
      console.log(`Heatmap screenshot: ${screenshot}`);
      captured = true;
      await window.webContents.executeJavaScript('globalThis.__heatmapVisualCaptured = true');
    }
    const result = await window.webContents.executeJavaScript('globalThis.__heatmapValidationResult ?? null');
    if (result) return finish(result);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return finish({ status: 'failed', message: 'Heatmap renderer validation timed out after 30 seconds' });
}

/** Close the renderer and server on both success and bounded failure. */
async function finish(result) {
  console.log(JSON.stringify(result));
  if (window && !window.isDestroyed()) window.destroy();
  if (server) await server.close();
  app.exit(result.status === 'passed' ? 0 : 1);
}
