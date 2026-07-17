"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose only fixed desktop methods. The renderer cannot choose IPC channel names.
contextBridge.exposeInMainWorld("csvMapDesktop", {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke("desktop:getStatus"),
  importCsvToSqlite: () => ipcRenderer.invoke("desktop:importCsvToSqlite"),
  queryMapView: (query) => ipcRenderer.invoke("desktop:queryMapView", query),
  // Expose structured lookup requests without exposing SQLite or raw SQL.
  getFeatureDetails: (query) => ipcRenderer.invoke('desktop:getFeatureDetails', query),
  getGroupRows: (query) => ipcRenderer.invoke('desktop:getGroupRows', query),
});
