"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose only fixed desktop methods. The renderer cannot choose IPC channel names.
contextBridge.exposeInMainWorld("csvMapDesktop", {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke("desktop:getStatus"),
  importCsvToSqlite: () => ipcRenderer.invoke("desktop:importCsvToSqlite"),
});
