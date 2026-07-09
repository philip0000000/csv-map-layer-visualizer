"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { importCsvFileToSqlite } = require("./csvImportService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");
const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");

// The prototype DB lives in Electron userData, not inside the repository.
const SQLITE_DB_FILE_NAME = "csv-map-layer-visualizer.sqlite";

function getDevServerUrl() {
  const devServerArg = process.argv.find((arg) => arg.startsWith("--dev-server="));
  return devServerArg ? devServerArg.slice("--dev-server=".length) : null;
}

/**
 * Register the small desktop API used by the renderer.
 * Keep file paths and database access in the main process.
 */
function registerDesktopBridgeHandlers() {
  ipcMain.handle("desktop:getStatus", () => ({
    ok: true,
    runtime: "electron",
  }));

  // The renderer asks to import, but the main process opens the file picker.
  ipcMain.handle("desktop:importCsvToSqlite", async () => {
    const fileResult = await dialog.showOpenDialog({
      title: "Import CSV to local SQLite",
      properties: ["openFile"],
      filters: [
        { name: "CSV files", extensions: ["csv"] },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (fileResult.canceled || fileResult.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const db = openSqliteStore(getDesktopDatabasePath());

    try {
      return importCsvFileToSqlite({
        db,
        filePath: fileResult.filePaths[0],
      });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle("desktop:queryMapView", async (_event, query = {}) => {
    const db = openSqliteStore(getDesktopDatabasePath());

    try {
      return querySqliteMapView({
        db,
        bounds: query?.bounds,
        timeline: query?.timeline,
        renderBudget: query?.renderBudget,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
}

/**
 * Return the per-user database path for the desktop app.
 */
function getDesktopDatabasePath() {
  return path.join(app.getPath("userData"), SQLITE_DB_FILE_NAME);
}

/**
 * Create the Electron window that hosts the existing Vite app.
 */
function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "CSV Map Layer Visualizer",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = getDevServerUrl();

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  registerDesktopBridgeHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
