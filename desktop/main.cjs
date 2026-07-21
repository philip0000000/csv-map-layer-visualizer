"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { importCsvFileToSqlite } = require("./csvImportService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");
const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");

const {
  getSqliteFeatureDetails,
  getSqliteGroupRows,
} = require('./sqliteDetailQuery.cjs');

const LOCAL_DATA_DIR_NAME = ".local-data";
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
    ...getDesktopDatabaseStatus(),
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

    const db = openDesktopSqliteStore();

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
    const db = openDesktopSqliteStore();

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
  ipcMain.handle('desktop:getFeatureDetails', async (_event, query = {}) => {
    // Keep SQLite access in the main process and return full rows only on demand.
    const db = openDesktopSqliteStore();

    try {
      return getSqliteFeatureDetails({
        db,
        sourceRef: query?.sourceRef,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle('desktop:getGroupRows', async (_event, query = {}) => {
    const db = openDesktopSqliteStore();

    try {
      return getSqliteGroupRows({
        db,
        groupRef: query?.groupRef,
        offset: query?.offset,
        limit: query?.limit,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
}

/**
 * Return the project-local database path for the desktop app.
 */
function getDesktopDatabasePath() {
  return path.join(__dirname, "..", LOCAL_DATA_DIR_NAME, SQLITE_DB_FILE_NAME);
}

/**
 * Detect persisted imports without creating a database on first startup.
 */
function getDesktopDatabaseStatus() {
  const dbPath = getDesktopDatabasePath();

  if (!fs.existsSync(dbPath)) {
    return {
      databaseExists: false,
      hasImportedData: false,
    };
  }

  const db = openDesktopSqliteStore();

  try {
    const row = db.prepare("SELECT EXISTS(SELECT 1 FROM datasets) AS has_imported_data").get();

    return {
      databaseExists: true,
      hasImportedData: row?.has_imported_data === 1,
    };
  } finally {
    closeSqliteStore(db);
  }
}

/**
 * Create the local data folder only when SQLite is first needed.
 */
function openDesktopSqliteStore() {
  const dbPath = getDesktopDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return openSqliteStore(dbPath);
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
