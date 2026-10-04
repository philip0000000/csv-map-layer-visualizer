import {
  BACKEND_FAILURE_CATEGORIES,
  DATA_SOURCE_METHODS,
  DEFAULT_GROUP_ROWS_LIMIT,
} from './dataSource.js';
import {
  normalizeBackendCapabilities,
  normalizeBackendFailure,
  normalizeDatasetCsvSaveResult,
  normalizeDatasetMutationResult,
  normalizeDatasetSummary,
  normalizeFeatureDetailsResult,
  normalizeGroupBoundsResult,
  normalizeGroupRowsResult,
  normalizeImportBatchResult,
  normalizeImportCancellationResult,
  normalizeImportProgress,
  normalizeInitializationResult,
  normalizeMapViewResult,
  normalizeLogicalZoneResult,
  normalizePreviewPageResult,
  normalizePreviewFeatureResult,
  normalizeSearchRowsResult,
} from './dataSourceNormalization.js';

const DEFAULT_SQLITE_RENDER_BUDGET = 1000;

/** Renderer-side contract adapter for the fixed Electron preload bridge. */
export function createDesktopSqliteDataSource({ desktopApi } = {}) {
  let disposed = false;
  let importSequence = 0;
  let activeImportId = null;
  let selectedDatasetId = null;
  const progressCleanups = new Set();
  const capabilities = normalizeBackendCapabilities({
    persistence: 'persistent',
    browserFileImport: false,
    nativeFilePickerImport: typeof desktopApi?.importCsvToSqlite === 'function',
    droppedFileImport: typeof desktopApi?.importDroppedCsvFiles === 'function',
    exampleImport: typeof desktopApi?.importExample === 'function',
    multipleFileImport:
      typeof desktopApi?.importCsvToSqlite === 'function' ||
      typeof desktopApi?.importDroppedCsvFiles === 'function',
    importProgress: typeof desktopApi?.onCsvImportProgress === 'function',
    importCancellation: typeof desktopApi?.cancelImport === 'function',
    datasetSelection: typeof desktopApi?.getPreviewPage === 'function',
    datasetVisibility: typeof desktopApi?.setDatasetEnabled === 'function',
    datasetRemoval: typeof desktopApi?.removeDataset === 'function',
    datasetCsvExport: typeof desktopApi?.saveDatasetAsCsv === 'function',
    datasetGeojsonExport: typeof desktopApi?.saveDatasetAsGeojson === 'function',
    datasetMapping: false,
    previewPaging: typeof desktopApi?.getPreviewPage === 'function',
    points: typeof desktopApi?.queryMapView === 'function',
    lines: typeof desktopApi?.queryMapView === 'function',
    regions: typeof desktopApi?.queryMapView === 'function',
    groupedViewportResults:
      typeof desktopApi?.queryMapView === 'function' &&
      typeof desktopApi?.getGroupRows === 'function',
    zoneEditing:
      typeof desktopApi?.getLogicalZone === 'function' &&
      typeof desktopApi?.updateLogicalZone === 'function',
  });

  return {
    async initialize() {
      if (disposed || typeof desktopApi?.getStatus !== 'function') {
        return normalizeInitializationResult(null);
      }
      try {
        const status = await desktopApi.getStatus();
        return normalizeInitializationResult({
          ok: status?.ok === true,
          capabilities,
        });
      } catch {
        return normalizeInitializationResult(null);
      }
    },

    getCapabilities() {
      return capabilities;
    },

    importBrowserFiles() {
      assertActive(DATA_SOURCE_METHODS.importBrowserFiles);
      return unsupportedImport(
        DATA_SOURCE_METHODS.importBrowserFiles,
        'Browser file imports are unavailable in the desktop backend.',
      );
    },

    importFromPicker() {
      assertActive(DATA_SOURCE_METHODS.importFromPicker);
      return runImport(
        DATA_SOURCE_METHODS.importFromPicker,
        () => desktopApi?.importCsvToSqlite?.(),
        capabilities.nativeFilePickerImport,
      );
    },

    importDroppedFiles(request = {}) {
      assertActive(DATA_SOURCE_METHODS.importDroppedFiles);
      return runImport(
        DATA_SOURCE_METHODS.importDroppedFiles,
        () => desktopApi?.importDroppedCsvFiles?.(Array.from(request.files ?? [])),
        capabilities.droppedFileImport,
      );
    },

    importExample(request = {}) {
      assertActive(DATA_SOURCE_METHODS.importExample);
      return runImport(
        DATA_SOURCE_METHODS.importExample,
        () => desktopApi?.importExample?.(request.name),
        capabilities.exampleImport,
      );
    },

    subscribeImportProgress(listener) {
      if (
        disposed ||
        typeof listener !== 'function' ||
        typeof desktopApi?.onCsvImportProgress !== 'function'
      ) {
        return () => {};
      }

      const bridgeCleanup = desktopApi.onCsvImportProgress((progress) => {
        const normalized = normalizeImportProgress({
          ...progress,
          importId: progress?.importId ?? activeImportId,
        });
        if (!normalized) return;
        try {
          listener(normalized);
        } catch {
          // A renderer observer cannot interrupt an import operation.
        }
      });
      let subscribed = true;
      const cleanup = () => {
        if (!subscribed) return;
        subscribed = false;
        progressCleanups.delete(cleanup);
        if (typeof bridgeCleanup === 'function') bridgeCleanup();
      };
      progressCleanups.add(cleanup);
      return cleanup;
    },

    async cancelImport(importId) {
      assertActive(DATA_SOURCE_METHODS.cancelImport);
      if (!capabilities.importCancellation || activeImportId !== importId) return normalizeImportCancellationResult(null, importId);
      try { return normalizeImportCancellationResult({ ok: true, ...await desktopApi.cancelImport() }, importId); }
      catch { return normalizeImportCancellationResult(null, importId); }
    },

    /** Reconcile session selection against the retained datasets without loading rows. */
    async getDatasetSummary() {
      assertActive(DATA_SOURCE_METHODS.getDatasetSummary);
      requireMethod(desktopApi?.getDatasetSummary, DATA_SOURCE_METHODS.getDatasetSummary);
      try {
        const result = await desktopApi.getDatasetSummary();
        if (!isRecord(result)) throw new TypeError('Malformed dataset summary');
        const summary = normalizeDatasetSummary(result);
        if (!summary.datasets.some((dataset) => dataset.id === selectedDatasetId)) {
          selectedDatasetId = capabilities.datasetSelection ? summary.datasets[0]?.id ?? null : null;
        }
        return { ...summary, selectedDatasetId };
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getDatasetSummary);
      }
    },

    /** Selection is session state only; it never changes persistent visibility. */
    async selectDataset(datasetId) {
      assertActive(DATA_SOURCE_METHODS.selectDataset);
      if (!capabilities.datasetSelection) {
        return unsupportedMutation(DATA_SOURCE_METHODS.selectDataset, datasetId);
      }
      const id = normalizeId(datasetId);
      try {
        const summary = normalizeDatasetSummary(await desktopApi.getDatasetSummary());
        const dataset = id ? summary.datasets.find((item) => item.id === id) : summary.datasets[0];
        if (id && !dataset) return normalizeDatasetMutationResult(null, { datasetId: id });
        const nextId = dataset?.id ?? null;
        const changed = nextId !== selectedDatasetId;
        selectedDatasetId = nextId;
        return normalizeDatasetMutationResult({ ok: true, changed, datasetId: nextId, dataset });
      } catch {
        return failedMutation(DATA_SOURCE_METHODS.selectDataset, id);
      }
    },

    async setDatasetEnabled(datasetId, enabled) {
      assertActive(DATA_SOURCE_METHODS.setDatasetEnabled);
      const normalizedId = normalizeId(datasetId);
      if (!capabilities.datasetVisibility) {
        return unsupportedMutation(DATA_SOURCE_METHODS.setDatasetEnabled, normalizedId);
      }
      if (!normalizedId || typeof enabled !== 'boolean') {
        return normalizeDatasetMutationResult(null, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.setDatasetEnabled,
        });
      }
      try {
        const result = await desktopApi.setDatasetEnabled(normalizedId, enabled);
        return normalizeDatasetMutationResult(result, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.setDatasetEnabled,
        });
      } catch {
        return failedMutation(DATA_SOURCE_METHODS.setDatasetEnabled, normalizedId);
      }
    },

    async removeDataset(datasetId) {
      assertActive(DATA_SOURCE_METHODS.removeDataset);
      const normalizedId = normalizeId(datasetId);
      if (!capabilities.datasetRemoval) {
        return unsupportedMutation(DATA_SOURCE_METHODS.removeDataset, normalizedId);
      }
      if (!normalizedId) {
        return normalizeDatasetMutationResult(null, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.removeDataset,
        });
      }
      try {
        const result = await desktopApi.removeDataset(normalizedId);
        return normalizeDatasetMutationResult(result, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.removeDataset,
        });
      } catch {
        return failedMutation(DATA_SOURCE_METHODS.removeDataset, normalizedId);
      }
    },

    /** Ask the restricted desktop bridge to own both the dialog and file write. */
    async saveDatasetAsCsv(datasetId) {
      assertActive(DATA_SOURCE_METHODS.saveDatasetAsCsv);
      const normalizedId = normalizeId(datasetId);
      if (!capabilities.datasetCsvExport || !normalizedId) {
        return normalizeDatasetCsvSaveResult(null, normalizedId);
      }
      try {
        return normalizeDatasetCsvSaveResult(
          await desktopApi.saveDatasetAsCsv(normalizedId),
          normalizedId,
        );
      } catch {
        return normalizeDatasetCsvSaveResult(null, normalizedId);
      }
    },

    /** Let the native bridge own the GeoJSON save dialog and atomic file write. */
    async saveDatasetAsGeojson(datasetId) {
      assertActive(DATA_SOURCE_METHODS.saveDatasetAsGeojson);
      const normalizedId = normalizeId(datasetId);
      try {
        return normalizeDatasetCsvSaveResult(await desktopApi.saveDatasetAsGeojson(normalizedId), normalizedId, 'geojson');
      } catch { return normalizeDatasetCsvSaveResult(null, normalizedId, 'geojson'); }
    },

    updateDatasetMapping(datasetId) {
      assertActive(DATA_SOURCE_METHODS.updateDatasetMapping);
      const normalizedId = normalizeId(datasetId) ?? '';
      return {
        ok: false,
        datasetId: normalizedId,
        mapping: null,
        detectedFields: null,
        dataset: null,
        error: unsupportedFailure(
          DATA_SOURCE_METHODS.updateDatasetMapping,
          'Coordinate mapping is unavailable in the desktop backend.',
          { datasetId: normalizedId },
        ),
      };
    },

    /** Request only bounded source rows through the fixed desktop bridge. */
    async getPreviewPage(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getPreviewPage);
      requireMethod(desktopApi?.getPreviewPage, DATA_SOURCE_METHODS.getPreviewPage);
      try {
        const result = await desktopApi.getPreviewPage({
          datasetId: normalizeId(query.datasetId),
          offset: query.offset ?? 0,
          limit: query.limit ?? 30,
        });
        if (!isRecord(result)) throw new TypeError('Malformed preview result');
        return normalizePreviewPageResult(result, query);
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getPreviewPage);
      }
    },

    async queryMapView(query = {}) {
      assertActive(DATA_SOURCE_METHODS.queryMapView);
      requireMethod(desktopApi?.queryMapView, DATA_SOURCE_METHODS.queryMapView);
      try {
        const result = await desktopApi.queryMapView({
          bounds: query.bounds ?? null,
          zoom: query.zoom ?? null,
          timeline: query.timeline ?? null,
          renderBudget: query.renderBudget ?? DEFAULT_SQLITE_RENDER_BUDGET,
          datasetIds: query.datasetIds ?? null,
        });
        if (!isRecord(result)) throw new TypeError('Malformed map result');
        return normalizeMapViewResult(result);
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.queryMapView);
      }
    },

    /** Read bounded search batches or result identities independently of map filters. */
    async getSearchRows(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getSearchRows);
      try {
        return normalizeSearchRowsResult(await desktopApi.getSearchRows({
          datasetId: query.datasetId, afterRowIndex: query.afterRowIndex, rowIndices: query.rowIndices,
        }));
      } catch { throw queryFailure(DATA_SOURCE_METHODS.getSearchRows); }
    },

    /** Resolve a source row independently of viewport grouping and limits. */
    async getPreviewFeature(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getPreviewFeature);
      try {
        return normalizePreviewFeatureResult(await desktopApi.getPreviewFeature({ sourceRef: query.sourceRef }));
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getPreviewFeature);
      }
    },

    async getFeatureDetails(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getFeatureDetails);
      requireMethod(desktopApi?.getFeatureDetails, DATA_SOURCE_METHODS.getFeatureDetails);
      const sourceRef = normalizeSourceRef(query.sourceRef);
      if (!sourceRef) throw queryFailure(DATA_SOURCE_METHODS.getFeatureDetails);
      try {
        const result = await desktopApi.getFeatureDetails({ sourceRef });
        if (!isRecord(result)) throw new TypeError('Malformed details result');
        return normalizeFeatureDetailsResult(result);
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getFeatureDetails);
      }
    },

    /** Read complete group bounds without paging through its source rows. */
    async getGroupBounds(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getGroupBounds);
      try {
        return normalizeGroupBoundsResult(await desktopApi.getGroupBounds({ groupRef: query.groupRef }));
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getGroupBounds);
      }
    },

    async getGroupRows(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getGroupRows);
      requireMethod(desktopApi?.getGroupRows, DATA_SOURCE_METHODS.getGroupRows);
      const groupRef = normalizeGroupRef(query.groupRef);
      if (!groupRef) throw queryFailure(DATA_SOURCE_METHODS.getGroupRows);
      const offset = normalizeNonNegativeInteger(query.offset, 0);
      const limit = normalizePositiveInteger(query.limit, DEFAULT_GROUP_ROWS_LIMIT);
      try {
        const result = await desktopApi.getGroupRows({ groupRef, offset, limit });
        if (!isRecord(result)) throw new TypeError('Malformed group result');
        return normalizeGroupRowsResult(result, { offset, limit });
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getGroupRows);
      }
    },

    async getLogicalZone(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getLogicalZone);
      requireMethod(desktopApi?.getLogicalZone, DATA_SOURCE_METHODS.getLogicalZone);
      try {
        return normalizeLogicalZoneResult(await desktopApi.getLogicalZone({
          datasetId: normalizeId(query.datasetId),
          featureId: normalizeId(query.featureId),
        }));
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.getLogicalZone, query.datasetId);
      }
    },

    async updateLogicalZone(request = {}) {
      assertActive(DATA_SOURCE_METHODS.updateLogicalZone);
      requireMethod(desktopApi?.updateLogicalZone, DATA_SOURCE_METHODS.updateLogicalZone);
      try {
        return normalizeLogicalZoneResult(await desktopApi.updateLogicalZone(request));
      } catch {
        throw queryFailure(DATA_SOURCE_METHODS.updateLogicalZone, request.datasetId);
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      selectedDatasetId = null;
      activeImportId = null;
      for (const cleanup of [...progressCleanups]) cleanup();
    },
  };

  async function runImport(operation, invoke, supported) {
    if (!supported) return unsupportedImport(operation);
    const importId = `desktop-import-${++importSequence}`;
    activeImportId = importId;
    try {
      const result = await invoke();
      return normalizeImportBatchResult({ ...result, importId }, { operation });
    } catch {
      return normalizeImportBatchResult({ importId }, { operation });
    } finally {
      activeImportId = null;
    }
  }

  function assertActive(operation) {
    if (!disposed) return;
    throw unsupportedFailure(
      operation,
      'The desktop data backend is unavailable.',
    );
  }
}

function unsupportedImport(operation, message) {
  return normalizeImportBatchResult(null, {
    operation,
    category: BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
    message: message ?? 'This import operation is unavailable.',
  });
}

function unsupportedMutation(operation, datasetId) {
  return {
    ok: false,
    datasetId: normalizeId(datasetId),
    changed: false,
    dataset: null,
    error: unsupportedFailure(operation, 'This dataset operation is unavailable.', {
      datasetId,
    }),
  };
}

function failedMutation(operation, datasetId) {
  return {
    ok: false,
    datasetId: normalizeId(datasetId),
    changed: false,
    dataset: null,
    error: normalizeBackendFailure(null, {
      category: BACKEND_FAILURE_CATEGORIES.QUERY_FAILED,
      operation,
      message: 'The dataset operation could not be completed.',
      recoverable: true,
      datasetId,
    }),
  };
}

function unsupportedFailure(operation, message, context = {}) {
  return normalizeBackendFailure(null, {
    category: BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
    operation,
    message,
    recoverable: false,
    ...context,
  });
}

function queryFailure(operation) {
  return normalizeBackendFailure(null, {
    category: BACKEND_FAILURE_CATEGORIES.QUERY_FAILED,
    operation,
    message: 'The requested desktop data could not be loaded.',
    recoverable: true,
  });
}

function requireMethod(method, operation) {
  if (typeof method !== 'function') {
    throw unsupportedFailure(operation, 'This desktop data operation is unavailable.');
  }
}

function normalizeSourceRef(value) {
  if (!isRecord(value)) return null;
  const datasetId = normalizeId(value.datasetId);
  const rowIndex = normalizeOptionalNonNegativeInteger(value.rowIndex);
  return datasetId && rowIndex != null ? { datasetId, rowIndex } : null;
}

/** Normalize the complete desktop group snapshot before sending a paging request. */
function normalizeGroupRef(value) {
  if (!isRecord(value) || value.sortOrder !== 'dataset-source-row') return null;
  const groupId = normalizeId(value.groupId);
  const bounds = normalizeBounds(value.bounds);
  const grid = normalizeGrid(value.grid);
  const timeline = normalizeTimeline(value.timeline);
  const datasetIds = normalizeDatasetIds(value.datasetIds);
  if (
    !groupId ||
    !bounds ||
    !grid ||
    timeline === undefined ||
    datasetIds.length === 0
  ) return null;
  if (groupId !== ['grid', grid.cellLat, grid.cellLon].join(':')) return null;
  return {
    groupId,
    bounds,
    datasetIds,
    grid,
    timeline,
    sortOrder: 'dataset-source-row',
  };
}

/** Normalize a non-empty, deterministic dataset snapshot for grouped paging. */
function normalizeDatasetIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeId).filter(Boolean))].sort();
}

function normalizeBounds(value) {
  if (!isRecord(value)) return null;
  const north = normalizeFiniteNumber(value.north);
  const south = normalizeFiniteNumber(value.south);
  const east = normalizeFiniteNumber(value.east);
  const west = normalizeFiniteNumber(value.west);
  return [north, south, east, west].every((item) => item != null)
    ? { north, south, east, west }
    : null;
}

function normalizeGrid(value) {
  if (!isRecord(value)) return null;
  const cellLat = normalizeInteger(value.cellLat);
  const cellLon = normalizeInteger(value.cellLon);
  const cellHeight = normalizePositiveNumber(value.cellHeight);
  const cellWidth = normalizePositiveNumber(value.cellWidth);
  return cellLat != null && cellLon != null && cellHeight && cellWidth
    ? { cellLat, cellLon, cellHeight, cellWidth }
    : null;
}

function normalizeTimeline(value) {
  if (!value?.timelineEnabled) return null;
  const startYear = normalizeInteger(value.startYear);
  const endYear = normalizeInteger(value.endYear);
  if (startYear == null || endYear == null) return undefined;
  return {
    timelineEnabled: true,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function normalizeOptionalNonNegativeInteger(value) {
  const number = normalizeFiniteNumber(value);
  return number != null && number >= 0 ? Math.trunc(number) : null;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = normalizeFiniteNumber(value);
  return number != null && number >= 0 ? Math.trunc(number) : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const number = normalizeFiniteNumber(value);
  return number != null && number > 0 ? Math.trunc(number) : fallback;
}

function normalizeInteger(value) {
  const number = normalizeFiniteNumber(value);
  return number == null ? null : Math.trunc(number);
}

function normalizePositiveNumber(value) {
  const number = normalizeFiniteNumber(value);
  return number != null && number > 0 ? number : null;
}

function normalizeFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
