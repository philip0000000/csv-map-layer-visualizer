import {
  BACKEND_FAILURE_CATEGORIES,
  DATA_SOURCE_METHODS,
} from '../dataSource.js';
import {
  normalizeBackendCapabilities,
  normalizeBackendFailure,
  normalizeDatasetMutationResult,
  normalizeDatasetSummary,
  normalizeImportBatchResult,
  normalizeImportCancellationResult,
  normalizeImportProgress,
  normalizeInitializationResult,
  normalizeFeatureDetailsResult,
  normalizeGroupRowsResult,
  normalizeMapViewResult,
  normalizeLogicalZoneResult,
  normalizeMappingMutationResult,
  normalizePreviewPageResult,
} from '../dataSourceNormalization.js';
import {
  createBrowserSqliteWorkerClient,
} from './browserSqliteWorkerClient.js';
import {
  fetchExampleBlob,
  normalizeExampleName,
} from '../browserExampleImport.js';

const CAPABILITIES = normalizeBackendCapabilities({
  persistence: 'temporary',
  browserFileImport: true,
  nativeFilePickerImport: false,
  droppedFileImport: true,
  exampleImport: true,
  multipleFileImport: true,
  importProgress: true,
  importCancellation: true,
  datasetSelection: true,
  datasetVisibility: true,
  datasetRemoval: true,
  datasetMapping: true,
  previewPaging: true,
  points: true,
  lines: true,
  regions: true,
  groupedViewportResults: true,
  zoneEditing: true,
});

/** Create the unselected browser SQLite data-source adapter. */
export function createBrowserSqliteDataSource(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? import.meta.env?.BASE_URL ?? '/';
  let workerClient = options.client ?? null;
  let clientCreationFailed = false;
  if (!workerClient) {
    try {
      workerClient = (options.createClient ?? createBrowserSqliteWorkerClient)();
    } catch {
      // Keep selection stable and surface initialization failure to the UI.
      clientCreationFailed = true;
    }
  }
  const progressListeners = new Set();
  let selectedDatasetId = null;
  let disposed = false;

  const dataSource = {
    async initialize() {
      if (disposed || clientCreationFailed || !workerClient) {
        return normalizeInitializationResult(null);
      }
      try {
        const result = await workerClient.initialize();
        return normalizeInitializationResult({
          ok: result?.initialized === true,
          capabilities: CAPABILITIES,
        });
      } catch {
        return normalizeInitializationResult(null);
      }
    },

    getCapabilities() {
      return CAPABILITIES;
    },

    importBrowserFiles(request = {}) {
      return runImport(request, DATA_SOURCE_METHODS.importBrowserFiles);
    },

    importFromPicker() {
      assertActive(DATA_SOURCE_METHODS.importFromPicker);
      return unsupportedImport(DATA_SOURCE_METHODS.importFromPicker);
    },

    importDroppedFiles(request = {}) {
      return runImport(request, DATA_SOURCE_METHODS.importDroppedFiles);
    },

    async importExample(request = {}) {
      assertActive(DATA_SOURCE_METHODS.importExample);
      const requested = normalizeExampleName(request.name);
      if (!requested) {
        return normalizeImportBatchResult(null, {
          operation: DATA_SOURCE_METHODS.importExample,
        });
      }
      const blob = await fetchExampleBlob({ requested, baseUrl, fetchImpl });
      if (!blob) {
        return normalizeImportBatchResult({
          results: [{ ok: false, fileName: requested }],
        }, { operation: DATA_SOURCE_METHODS.importExample });
      }
      return runImport({
        files: [createExampleFile(blob, requested.split('/').pop())],
      }, DATA_SOURCE_METHODS.importExample);
    },

    subscribeImportProgress(listener) {
      if (disposed || typeof listener !== 'function') return () => {};
      progressListeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        progressListeners.delete(listener);
      };
    },

    async cancelImport(importId) {
      assertActive(DATA_SOURCE_METHODS.cancelImport);
      try {
        const result = await workerClient.cancelImport(importId);
        return normalizeImportCancellationResult(result, importId);
      } catch {
        return normalizeImportCancellationResult(null, importId);
      }
    },

    async getDatasetSummary() {
      assertActive(DATA_SOURCE_METHODS.getDatasetSummary);
      try {
        const result = normalizeDatasetSummary(
          await workerClient.getDatasetSummary(),
        );
        if (!result.datasets.some((item) => item.id === selectedDatasetId)) {
          selectedDatasetId = result.datasets[0]?.id ?? null;
        }
        return { ...result, selectedDatasetId };
      } catch (error) {
        throw workerFailure(
          DATA_SOURCE_METHODS.getDatasetSummary,
          error,
        );
      }
    },

    async selectDataset(datasetId) {
      assertActive(DATA_SOURCE_METHODS.selectDataset);
      const requestedId = normalizeId(datasetId);
      let summary;
      try {
        summary = await dataSource.getDatasetSummary();
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.selectDataset, error, {
          datasetId: requestedId,
        });
      }
      const nextDataset = requestedId
        ? summary.datasets.find((item) => item.id === requestedId)
        : summary.datasets[0] ?? null;
      if (requestedId && !nextDataset) {
        return normalizeDatasetMutationResult(null, {
          datasetId: requestedId,
          operation: DATA_SOURCE_METHODS.selectDataset,
        });
      }
      const nextId = nextDataset?.id ?? null;
      const changed = nextId !== selectedDatasetId;
      selectedDatasetId = nextId;
      return normalizeDatasetMutationResult({
        ok: true,
        changed,
        datasetId: nextId,
        dataset: nextDataset,
      }, {
        datasetId: nextId,
        operation: DATA_SOURCE_METHODS.selectDataset,
      });
    },

    async setDatasetEnabled(datasetId, enabled) {
      assertActive(DATA_SOURCE_METHODS.setDatasetEnabled);
      const normalizedId = normalizeId(datasetId);
      if (!normalizedId || typeof enabled !== 'boolean') {
        return normalizeDatasetMutationResult(null, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.setDatasetEnabled,
        });
      }
      try {
        return normalizeDatasetMutationResult(
          await workerClient.setDatasetEnabled(normalizedId, enabled),
          {
            datasetId: normalizedId,
            operation: DATA_SOURCE_METHODS.setDatasetEnabled,
          },
        );
      } catch (error) {
        return failedDatasetMutation(
          DATA_SOURCE_METHODS.setDatasetEnabled,
          normalizedId,
          error,
        );
      }
    },

    async removeDataset(datasetId) {
      assertActive(DATA_SOURCE_METHODS.removeDataset);
      const normalizedId = normalizeId(datasetId);
      if (!normalizedId) {
        return normalizeDatasetMutationResult(null, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.removeDataset,
        });
      }
      try {
        const result = normalizeDatasetMutationResult(
          await workerClient.removeDataset(normalizedId),
          {
            datasetId: normalizedId,
            operation: DATA_SOURCE_METHODS.removeDataset,
          },
        );
        if (result.ok && selectedDatasetId === normalizedId) {
          selectedDatasetId = null;
        }
        return result;
      } catch (error) {
        return failedDatasetMutation(
          DATA_SOURCE_METHODS.removeDataset,
          normalizedId,
          error,
        );
      }
    },

    async updateDatasetMapping(datasetId, mapping = {}) {
      assertActive(DATA_SOURCE_METHODS.updateDatasetMapping);
      const normalizedId = normalizeId(datasetId) ?? '';
      if (!normalizedId || !isRecord(mapping)) {
        return normalizeMappingMutationResult(null, normalizedId);
      }
      try {
        return normalizeMappingMutationResult(
          await workerClient.updateDatasetMapping(normalizedId, mapping),
          normalizedId,
        );
      } catch (error) {
        if (error?.code === 'invalid-mapping') {
          return normalizeMappingMutationResult(null, normalizedId);
        }
        return {
          ok: false,
          datasetId: normalizedId,
          mapping: null,
          detectedFields: null,
          dataset: null,
          error: workerFailure(
            DATA_SOURCE_METHODS.updateDatasetMapping,
            error,
            { datasetId: normalizedId },
          ),
        };
      }
    },

    async getPreviewPage(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getPreviewPage);
      try {
        const result = await workerClient.getPreviewPage(query.datasetId, {
          offset: query.offset,
          limit: query.limit,
        });
        return normalizePreviewPageResult(result, query);
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.getPreviewPage, error, {
          datasetId: query.datasetId,
        });
      }
    },

    async queryMapView(query = {}) {
      assertActive(DATA_SOURCE_METHODS.queryMapView);
      try {
        return normalizeMapViewResult(await workerClient.queryMapView(query));
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.queryMapView, error);
      }
    },

    async getFeatureDetails(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getFeatureDetails);
      try {
        return normalizeFeatureDetailsResult(
          await workerClient.getFeatureDetails(query),
        );
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.getFeatureDetails, error, {
          datasetId: query.sourceRef?.datasetId,
        });
      }
    },

    async getGroupRows(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getGroupRows);
      try {
        return normalizeGroupRowsResult(
          await workerClient.getGroupRows(query),
          query,
        );
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.getGroupRows, error);
      }
    },

    async getLogicalZone(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getLogicalZone);
      try {
        return normalizeLogicalZoneResult(await workerClient.getLogicalZone(query));
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.getLogicalZone, error, {
          datasetId: query.datasetId,
        });
      }
    },

    async updateLogicalZone(request = {}) {
      assertActive(DATA_SOURCE_METHODS.updateLogicalZone);
      try {
        return normalizeLogicalZoneResult(await workerClient.updateLogicalZone(request));
      } catch (error) {
        throw workerFailure(DATA_SOURCE_METHODS.updateLogicalZone, error, {
          datasetId: request.datasetId,
        });
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      selectedDatasetId = null;
      progressListeners.clear();
      workerClient?.dispose();
      workerClient = null;
    },
  };

  async function runImport(request, operation) {
    assertActive(operation);
    let importId = null;
    try {
      const task = workerClient.startImport(Array.from(request.files ?? []), {
        onProgress: reportProgress,
      });
      importId = task.importId;
      const result = await task.result;
      const normalized = normalizeImportBatchResult(result, { operation });
      const firstImportedDataset = normalized.results.find(
        (item) => item.ok && item.datasetId,
      );
      if (firstImportedDataset) {
        // Match the raw browser workflow: the first successful file from the
        // newest batch becomes selected, even when another file failed.
        selectedDatasetId = firstImportedDataset.datasetId;
      }
      return normalized;
    } catch (error) {
      return normalizeImportBatchResult({ importId }, {
        operation,
        category: error?.code === 'worker-unavailable'
          ? BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE
          : BACKEND_FAILURE_CATEGORIES.IMPORT_FAILED,
        message: error?.code === 'worker-unavailable'
          ? 'The temporary browser database is unavailable.'
          : 'No CSV files were imported.',
      });
    }
  }

  function reportProgress(value) {
    const progress = normalizeImportProgress(value);
    if (!progress) return;
    for (const listener of [...progressListeners]) {
      try {
        listener(progress);
      } catch {
        // Progress observers cannot interrupt an active import.
      }
    }
  }

  function assertActive(operation) {
    if (!disposed && workerClient) return;
    throw workerFailure(operation, { code: 'worker-unavailable' });
  }

  return dataSource;
}

function createExampleFile(blob, name) {
  if (typeof File === 'function') {
    return new File([blob], name, {
      type: blob.type || 'text/csv',
      lastModified: 0,
    });
  }
  Object.defineProperties(blob, {
    name: { value: name, enumerable: true },
    lastModified: { value: 0, enumerable: true },
  });
  return blob;
}

function failedDatasetMutation(operation, datasetId, error) {
  if (error?.code === 'dataset-not-found') {
    return normalizeDatasetMutationResult(null, { datasetId, operation });
  }
  return {
    ok: false,
    datasetId,
    changed: false,
    dataset: null,
    error: workerFailure(operation, error, { datasetId }),
  };
}

function unsupportedImport(operation) {
  return normalizeImportBatchResult(null, {
    operation,
    category: BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
    message: 'This import operation is unavailable.',
  });
}

function workerFailure(operation, error, context = {}) {
  const code = error?.code;
  const category = code === 'worker-unavailable'
    ? BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE
    : code === 'dataset-not-found'
      ? BACKEND_FAILURE_CATEGORIES.DATASET_NOT_FOUND
      : code === 'invalid-mapping'
        ? BACKEND_FAILURE_CATEGORIES.INVALID_MAPPING
        : BACKEND_FAILURE_CATEGORIES.QUERY_FAILED;
  const message = category === BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE
    ? 'The temporary browser database is unavailable.'
    : category === BACKEND_FAILURE_CATEGORIES.DATASET_NOT_FOUND
      ? 'The selected dataset is unavailable.'
      : category === BACKEND_FAILURE_CATEGORIES.INVALID_MAPPING
        ? 'The coordinate mapping is invalid.'
        : 'The requested browser data could not be loaded.';
  return normalizeBackendFailure(null, {
    category,
    operation,
    message,
    recoverable: category !== BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
    ...context,
  });
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
