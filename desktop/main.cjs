"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { importCsvFilesToSqlite } = require("./csvImportService.cjs");
const { importDroppedCsvFilesToSqlite } = require("./droppedCsvImport.cjs");
const {
  getSqliteDatasetSummary,
  removeSqliteDataset,
  setSqliteDatasetEnabled,
} = require("./sqliteDatasetService.cjs");
const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");
const { exportSqliteDatasetCsv } = require("./sqliteDatasetExport.cjs");
const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
const {
  getSqliteLogicalZone,
  updateSqliteLogicalZone,
} = require("./sqliteZoneService.cjs");

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
  ipcMain.handle("desktop:importCsvToSqlite", async (event) => {
    const fileResult = await dialog.showOpenDialog({
      title: "Import CSV files",
      properties: ["openFile", "multiSelections"],
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
      return importCsvFilesToSqlite({
        db,
        filePaths: fileResult.filePaths,
        onProgress: (progress) => sendCsvImportProgress(event, progress),
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
  ipcMain.handle("desktop:importDroppedCsvFiles", async (event, request = {}) => {
    const db = openDesktopSqliteStore();

    try {
      return importDroppedCsvFilesToSqlite({
        db,
        filePaths: request?.filePaths,
        onProgress: (progress) => sendCsvImportProgress(event, progress),
      });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle("desktop:getDatasetSummary", async () => {
    const db = openDesktopSqliteStore();

    try {
      return getSqliteDatasetSummary({ db });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle("desktop:setDatasetEnabled", async (_event, request = {}) => {
    const db = openDesktopSqliteStore();

    try {
      return setSqliteDatasetEnabled({
        db,
        datasetId: request?.datasetId,
        enabled: request?.enabled,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle("desktop:removeDataset", async (_event, request = {}) => {
    const db = openDesktopSqliteStore();

    try {
      return removeSqliteDataset({
        db,
        datasetId: request?.datasetId,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle("desktop:saveDatasetAsCsv", async (event, request = {}) => {
    const requestedDatasetId = typeof request?.datasetId === "string"
      ? request.datasetId.trim()
      : null;
    let exported;

    try {
      const db = openDesktopSqliteStore();
      try {
        // Serialize before opening the dialog so no partial output can precede a failure.
        exported = exportSqliteDatasetCsv({ db, datasetId: requestedDatasetId });
      } finally {
        closeSqliteStore(db);
      }

      const owner = BrowserWindow.fromWebContents(event.sender);
      const saveResult = await dialog.showSaveDialog(owner, {
        title: "Save CSV dataset",
        defaultPath: exported.fileName,
        filters: [
          { name: "CSV files", extensions: ["csv"] },
          { name: "All files", extensions: ["*"] },
        ],
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: false, canceled: true, datasetId: exported.datasetId };
      }

      writeUtf8FileAtomically(saveResult.filePath, exported.csvText);
      return {
        ok: true,
        canceled: false,
        datasetId: exported.datasetId,
        fileName: path.basename(saveResult.filePath),
      };
    } catch {
      // Raw paths, SQLite details, and filesystem errors never cross the preload boundary.
      return { ok: false, canceled: false, datasetId: requestedDatasetId };
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
  ipcMain.handle('desktop:getLogicalZone', async (_event, query = {}) => {
    const db = openDesktopSqliteStore();
    try {
      return getSqliteLogicalZone({
        db,
        datasetId: query?.datasetId,
        featureId: query?.featureId,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
  ipcMain.handle('desktop:updateLogicalZone', async (_event, request = {}) => {
    const db = openDesktopSqliteStore();
    try {
      return updateSqliteLogicalZone({
        db,
        datasetId: request?.datasetId,
        featureId: request?.featureId,
        parts: request?.parts,
      });
    } finally {
      closeSqliteStore(db);
    }
  });
}

function sendCsvImportProgress(event, progress) {
  if (!event?.sender || event.sender.isDestroyed()) return;
  event.sender.send("desktop:csvImportProgress", progress);
}

/** Write beside the destination, then replace it only after UTF-8 output succeeds. */
function writeUtf8FileAtomically(destination, contents) {
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, destination);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // Cleanup failure must not replace the original export error.
    }
    throw error;
  }
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
