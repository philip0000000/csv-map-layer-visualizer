"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Expose only fixed desktop methods. The renderer cannot choose IPC channel names.
contextBridge.exposeInMainWorld("csvMapDesktop", {
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke("desktop:getStatus"),
  importCsvToSqlite: () => ipcRenderer.invoke("desktop:importCsvToSqlite"),
  importDroppedCsvFiles: (files) => {
    const filePaths = Array.from(files ?? []).map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    });
    return ipcRenderer.invoke("desktop:importDroppedCsvFiles", { filePaths });
  },
  onCsvImportProgress: (callback) => {
    if (typeof callback !== "function") return () => {};

    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("desktop:csvImportProgress", listener);
    return () => ipcRenderer.removeListener("desktop:csvImportProgress", listener);
  },
  queryMapView: (query) => ipcRenderer.invoke("desktop:queryMapView", query),
  getDatasetSummary: () => ipcRenderer.invoke("desktop:getDatasetSummary"),
  setDatasetEnabled: (datasetId, enabled) => ipcRenderer.invoke(
    "desktop:setDatasetEnabled",
    { datasetId, enabled },
  ),
  removeDataset: (datasetId) => ipcRenderer.invoke(
    "desktop:removeDataset",
    { datasetId },
  ),
  saveDatasetAsCsv: (datasetId) => ipcRenderer.invoke(
    "desktop:saveDatasetAsCsv",
    { datasetId },
  ),
  // Expose structured lookup requests without exposing SQLite or raw SQL.
  getFeatureDetails: (query) => ipcRenderer.invoke('desktop:getFeatureDetails', query),
  getGroupRows: (query) => ipcRenderer.invoke('desktop:getGroupRows', query),
  getLogicalZone: (query) => ipcRenderer.invoke('desktop:getLogicalZone', query),
  updateLogicalZone: (request) => ipcRenderer.invoke('desktop:updateLogicalZone', request),
  // Custom tile settings use fixed operations; no path or channel is renderer-controlled.
  loadCustomTileLayers: () => ipcRenderer.invoke("desktop:loadCustomTileLayers"),
  addCustomTileLayer: (definition) => ipcRenderer.invoke(
    "desktop:addCustomTileLayer",
    { definition },
  ),
  removeCustomTileLayer: (layerId) => ipcRenderer.invoke(
    "desktop:removeCustomTileLayer",
    { layerId },
  ),
});
