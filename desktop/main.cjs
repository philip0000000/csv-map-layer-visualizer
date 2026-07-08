"use strict";

const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

function getDevServerUrl() {
  const devServerArg = process.argv.find((arg) => arg.startsWith("--dev-server="));
  return devServerArg ? devServerArg.slice("--dev-server=".length) : null;
}

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


