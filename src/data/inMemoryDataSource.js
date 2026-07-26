/**
 * Browser DataSource backed by CSV files already loaded in memory.
 * It keeps current map behavior while giving the UI a backend-neutral API.
 */
import { deriveMapFeaturesFromFiles } from "./mapFeatureDerivation";
import { parseCsvBlob, parseCsvFile } from '../components/csvParse.js';
import { autoDetectLatLon } from '../components/geoColumns.js';
import {
  autoDetectRangeFields,
  autoDetectTimelineFields,
} from '../components/timeline.js';
import {
  BACKEND_FAILURE_CATEGORIES,
  DATA_SOURCE_METHODS,
  DEFAULT_PREVIEW_ROWS_LIMIT,
} from './dataSource.js';
import {
  normalizeBackendCapabilities,
  normalizeBackendFailure,
  normalizeDatasetMutationResult,
  normalizeDatasetSummary,
  normalizeFeatureDetailsResult,
  normalizeGroupRowsResult,
  normalizeImportBatchResult,
  normalizeImportCancellationResult,
  normalizeImportProgress,
  normalizeInitializationResult,
  normalizeMapViewResult,
  normalizeMappingMutationResult,
  normalizePreviewPageResult,
} from './dataSourceNormalization.js';

const DEFAULT_GROUP_ROWS_LIMIT = 30;

export function createInMemoryDataSource(options = {}) {
  let datasets = Array.isArray(options.files) ? [...options.files] : [];
  let selectedDatasetId = getInitialSelection(
    datasets,
    options.selectedDatasetId,
  );
  let disposed = false;
  let importSequence = 0;
  const progressListeners = new Set();
  const parseFile = options.parseFile ?? parseCsvFile;
  const parseBlob = options.parseBlob ?? parseCsvBlob;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? import.meta.env?.BASE_URL ?? '/';
  const onStateChange = typeof options.onStateChange === 'function'
    ? options.onStateChange
    : null;
  const capabilities = normalizeBackendCapabilities({
    persistence: 'temporary',
    browserFileImport: true,
    nativeFilePickerImport: false,
    droppedFileImport: true,
    exampleImport: true,
    multipleFileImport: true,
    importProgress: true,
    importCancellation: false,
    datasetSelection: true,
    datasetVisibility: true,
    datasetRemoval: true,
    datasetMapping: true,
    previewPaging: true,
    points: true,
    lines: true,
    regions: true,
    groupedViewportResults: false,
  });

  return {
    initialize() {
      if (disposed) {
        return normalizeInitializationResult(null);
      }
      return normalizeInitializationResult({ ok: true, capabilities });
    },

    getCapabilities() {
      return capabilities;
    },

    importBrowserFiles(request = {}) {
      assertActive(DATA_SOURCE_METHODS.importBrowserFiles);
      const files = Array.isArray(request.files) ? request.files : [];
      return runImportEntries(
        files.map((file) => ({
          name: file?.name,
          size: file?.size,
          lastModified: file?.lastModified,
          parse: () => parseFile(file),
        })),
        DATA_SOURCE_METHODS.importBrowserFiles,
      );
    },

    importFromPicker() {
      assertActive(DATA_SOURCE_METHODS.importFromPicker);
      return normalizeImportBatchResult(null, {
        operation: DATA_SOURCE_METHODS.importFromPicker,
        category: BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
        message: 'A backend-owned file picker is unavailable in the browser.',
      });
    },

    importDroppedFiles(request = {}) {
      assertActive(DATA_SOURCE_METHODS.importDroppedFiles);
      const files = Array.isArray(request.files) ? request.files : [];
      return runImportEntries(
        files.map((file) => ({
          name: file?.name,
          size: file?.size,
          lastModified: file?.lastModified,
          parse: () => parseFile(file),
        })),
        DATA_SOURCE_METHODS.importDroppedFiles,
      );
    },

    async importExample(request = {}) {
      assertActive(DATA_SOURCE_METHODS.importExample);
      const requested = normalizeExampleName(request.name);
      if (!requested) {
        return normalizeImportBatchResult(null, {
          operation: DATA_SOURCE_METHODS.importExample,
        });
      }

      const blob = await fetchExampleBlob({
        requested,
        baseUrl,
        fetchImpl,
      });
      if (!blob) {
        return normalizeImportBatchResult({
          results: [{ ok: false, fileName: requested }],
        }, { operation: DATA_SOURCE_METHODS.importExample });
      }

      return runImportEntries([{
        name: requested,
        size: blob.size,
        lastModified: null,
        parse: () => parseBlob(blob),
      }], DATA_SOURCE_METHODS.importExample);
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

    cancelImport(importId) {
      assertActive(DATA_SOURCE_METHODS.cancelImport);
      return normalizeImportCancellationResult(null, importId);
    },

    selectDataset(datasetId) {
      assertActive(DATA_SOURCE_METHODS.selectDataset);
      const normalizedId = normalizeId(datasetId);
      if (normalizedId && !getDataset(datasets, normalizedId)) {
        return normalizeDatasetMutationResult(null, {
          datasetId: normalizedId,
          operation: DATA_SOURCE_METHODS.selectDataset,
        });
      }
      const nextId = normalizedId ?? datasets[0]?.id ?? null;
      const changed = nextId !== selectedDatasetId;
      selectedDatasetId = nextId;
      notifyStateChange();
      return normalizeDatasetMutationResult({
        ok: true,
        changed,
        datasetId: selectedDatasetId,
        dataset: getDataset(datasets, selectedDatasetId),
      }, {
        datasetId: selectedDatasetId,
        operation: DATA_SOURCE_METHODS.selectDataset,
      });
    },

    setDatasetEnabled(datasetId, enabled) {
      assertActive(DATA_SOURCE_METHODS.setDatasetEnabled);
      const dataset = getDataset(datasets, datasetId);
      if (!dataset || typeof enabled !== 'boolean') {
        return normalizeDatasetMutationResult(null, {
          datasetId,
          operation: DATA_SOURCE_METHODS.setDatasetEnabled,
        });
      }
      const changed = dataset.enabled !== enabled;
      datasets = datasets.map((item) => item.id === dataset.id
        ? { ...item, enabled }
        : item);
      notifyStateChange();
      return normalizeDatasetMutationResult({
        ok: true,
        changed,
        datasetId: dataset.id,
        dataset: getDataset(datasets, dataset.id),
      }, {
        datasetId: dataset.id,
        operation: DATA_SOURCE_METHODS.setDatasetEnabled,
      });
    },

    removeDataset(datasetId) {
      assertActive(DATA_SOURCE_METHODS.removeDataset);
      const dataset = getDataset(datasets, datasetId);
      if (!dataset) {
        return normalizeDatasetMutationResult(null, {
          datasetId,
          operation: DATA_SOURCE_METHODS.removeDataset,
        });
      }
      datasets = datasets.filter((item) => item.id !== dataset.id);
      if (selectedDatasetId === dataset.id) {
        selectedDatasetId = datasets[0]?.id ?? null;
      }
      notifyStateChange();
      return normalizeDatasetMutationResult({
        ok: true,
        changed: true,
        datasetId: dataset.id,
      }, {
        datasetId: dataset.id,
        operation: DATA_SOURCE_METHODS.removeDataset,
      });
    },

    updateDatasetMapping(datasetId, mapping = {}) {
      assertActive(DATA_SOURCE_METHODS.updateDatasetMapping);
      const dataset = getDataset(datasets, datasetId);
      const normalizedMapping = normalizeRequestedMapping(dataset, mapping);
      if (!dataset || !normalizedMapping) {
        return normalizeMappingMutationResult(null, datasetId);
      }
      datasets = datasets.map((item) => item.id === dataset.id
        ? { ...item, ...normalizedMapping }
        : item);
      notifyStateChange();
      const updated = getDataset(datasets, dataset.id);
      return normalizeMappingMutationResult({
        ok: true,
        datasetId: dataset.id,
        mapping: normalizedMapping,
        detectedFields: getDetectedFields(updated.headers),
        dataset: updated,
      }, dataset.id);
    },

    getPreviewPage(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getPreviewPage);
      const dataset = getDataset(datasets, query.datasetId);
      if (!dataset) {
        throw normalizeBackendFailure(null, {
          category: BACKEND_FAILURE_CATEGORIES.DATASET_NOT_FOUND,
          operation: DATA_SOURCE_METHODS.getPreviewPage,
          message: 'The selected dataset is unavailable.',
          recoverable: true,
          datasetId: query.datasetId,
        });
      }
      const offset = Math.max(0, Number.parseInt(query.offset ?? 0, 10) || 0);
      const limit = Math.max(
        1,
        Number.parseInt(query.limit ?? DEFAULT_PREVIEW_ROWS_LIMIT, 10) ||
          DEFAULT_PREVIEW_ROWS_LIMIT,
      );
      return normalizePreviewPageResult({
        datasetId: dataset?.id,
        rows: (dataset?.rows ?? []).slice(offset, offset + limit),
        offset,
        limit,
        totalRows: dataset?.totalRows ?? dataset?.rows?.length ?? 0,
      }, query);
    },

    // Build the compact map data that Leaflet needs to render the current view.
    queryMapView(query = {}) {
      assertActive(DATA_SOURCE_METHODS.queryMapView);
      const queryDatasets = scopeDatasets(datasets, query.datasetIds);
      const derived = deriveMapFeaturesFromFiles({
        files: queryDatasets,
        timeline: query.timeline ?? null,
      });

      const normalized = normalizeMapViewResult({
        points: derived.points.points.map(toDataSourceFeature),
        lines: derived.lines.lines.map(toDataSourceFeature),
        regions: derived.regions.polygons.map(toDataSourceFeature),
        stats: {
          skippedPoints: derived.points.skipped,
          skippedLines: derived.lines.skipped,
          skippedRegions: derived.regions.skipped,
          skippedPointsByTimeline: derived.points.skippedByTimeline,
          skippedLinesByTimeline: derived.lines.skippedByTimeline,
          skippedRegionsByTimeline: derived.regions.skippedByTimeline,
          skippedByTimeline:
            (derived.points.skippedByTimeline ?? 0) +
            (derived.lines.skippedByTimeline ?? 0) +
            (derived.regions.skippedByTimeline ?? 0),
          limitedToRenderBudget: null,
        },
        timelineIndex: derived.timelineIndex,
      });
      return addLegacySourceFields(normalized);
    },

    // Return the original CSV row for a selected feature popup/detail view.
    getFeatureDetails(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getFeatureDetails);
      const sourceRef = query.sourceRef ?? null;
      const row = getSourceRow(datasets, sourceRef);
      const dataset = getDataset(datasets, sourceRef?.datasetId);

      return normalizeFeatureDetailsResult({
        featureId: query.featureId ?? null,
        row,
        latField: dataset?.latField ?? null,
        lonField: dataset?.lonField ?? null,
      });
    },

    // Return one page of source rows. Today this is dataset-based, not grouped markers.
    getGroupRows(query = {}) {
      assertActive(DATA_SOURCE_METHODS.getGroupRows);
      const dataset = getDataset(datasets, query.datasetId ?? query.groupId);
      const rows = dataset?.rows ?? [];
      const offset = Math.max(0, Number.parseInt(query.offset ?? 0, 10) || 0);
      const limit = Math.max(
        0,
        Number.parseInt(query.limit ?? DEFAULT_GROUP_ROWS_LIMIT, 10) || 0,
      );

      return normalizeGroupRowsResult({
        rows: rows.slice(offset, offset + limit),
        offset,
        limit,
        totalRows: dataset?.totalRows ?? rows.length,
      }, query);
    },

    // Return file-level metadata used by panels and future dataset-aware UI.
    getDatasetSummary() {
      assertActive(DATA_SOURCE_METHODS.getDatasetSummary);
      return normalizeDatasetSummary({
        datasets: datasets.map((file) => ({
          id: file.id,
          name: file.name,
          enabled: !!file.enabled,
          headers: file.headers ?? [],
          rowCount: file.rows?.length ?? 0,
          totalRows: file.totalRows ?? file.rows?.length ?? 0,
          latField: file.latField ?? null,
          lonField: file.lonField ?? null,
          parseErrors: file.parseErrors ?? [],
          sizeBytes: file.size ?? null,
          detectedFields: getDetectedFields(file.headers),
        })),
        selectedDatasetId,
        timeline: getTimelineSummary(datasets),
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      progressListeners.clear();
    },
  };

  async function runImportEntries(entries, operation) {
    const importId = `browser-import-${++importSequence}`;
    const remainingSlots = Math.max(0, 100 - datasets.length);
    const acceptedEntries = entries.slice(0, remainingSlots);
    const rejectedEntries = entries.slice(remainingSlots);
    const results = [];
    const imported = [];

    for (let index = 0; index < acceptedEntries.length; index += 1) {
      const entry = acceptedEntries[index];
      emitProgress({
        importId,
        state: 'started',
        fileName: entry.name,
        fileNumber: index + 1,
        totalFiles: entries.length,
      });

      try {
        const parsed = await entry.parse();
        const item = createImportedDataset(entry, parsed);
        imported.push(item);
        results.push(toImportFileResult(item));
        emitProgress({
          importId,
          state: 'completed',
          fileName: entry.name,
          fileNumber: index + 1,
          totalFiles: entries.length,
          completedRows: item.totalRows,
          totalRows: item.totalRows,
          ok: true,
        });
      } catch {
        results.push({ ok: false, fileName: entry.name });
        emitProgress({
          importId,
          state: 'completed',
          fileName: entry.name,
          fileNumber: index + 1,
          totalFiles: entries.length,
          ok: false,
        });
      }
    }

    for (const entry of rejectedEntries) {
      results.push({ ok: false, fileName: entry.name });
    }

    if (imported.length > 0) {
      datasets = [...imported, ...datasets];
      selectedDatasetId = imported[0].id;
      notifyStateChange();
    }

    return normalizeImportBatchResult({ importId, results }, { operation });
  }

  function emitProgress(progress) {
    const normalizedProgress = normalizeImportProgress(progress);
    if (!normalizedProgress) return;
    for (const listener of progressListeners) {
      try {
        listener(normalizedProgress);
      } catch {
        // Progress observers cannot interrupt browser parsing or state updates.
      }
    }
  }

  function notifyStateChange() {
    onStateChange?.({ files: [...datasets], selectedDatasetId });
  }

  function assertActive(operation) {
    if (!disposed) return;
    throw normalizeBackendFailure(null, {
      category: BACKEND_FAILURE_CATEGORIES.BACKEND_UNAVAILABLE,
      operation,
      message: 'The browser data backend is unavailable.',
      recoverable: false,
    });
  }
}

function getInitialSelection(datasets, requestedId) {
  const normalizedId = normalizeId(requestedId);
  return getDataset(datasets, normalizedId)?.id ?? datasets[0]?.id ?? null;
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function scopeDatasets(datasets, datasetIds) {
  if (!Array.isArray(datasetIds)) return datasets;
  const enabledIds = new Set(datasetIds.map(normalizeId).filter(Boolean));
  return datasets.map((dataset) => ({
    ...dataset,
    enabled: enabledIds.has(dataset.id),
  }));
}

function normalizeRequestedMapping(dataset, mapping) {
  if (!dataset || !mapping || typeof mapping !== 'object') return null;
  const headers = new Set(dataset.headers ?? []);
  const latField = Object.hasOwn(mapping, 'latField')
    ? normalizeId(mapping.latField)
    : normalizeId(dataset.latField);
  const lonField = Object.hasOwn(mapping, 'lonField')
    ? normalizeId(mapping.lonField)
    : normalizeId(dataset.lonField);
  if (latField && !headers.has(latField)) return null;
  if (lonField && !headers.has(lonField)) return null;
  return { latField, lonField };
}

function getDetectedFields(headers) {
  const coordinateFields = autoDetectLatLon(headers ?? []);
  return {
    ...coordinateFields,
    ...autoDetectTimelineFields(headers ?? []),
    ...autoDetectRangeFields(headers ?? []),
  };
}

function addLegacySourceFields(mapView) {
  const addFields = (feature) => feature.sourceRef
    ? {
        ...feature,
        sourceFileId: feature.sourceRef.datasetId,
        sourceRowIndex: feature.sourceRef.rowIndex,
      }
    : feature;

  return {
    ...mapView,
    points: mapView.points.map(addFields),
    lines: mapView.lines.map(addFields),
    regions: mapView.regions.map(addFields),
  };
}

function createImportedDataset(entry, parsed) {
  const headers = Array.isArray(parsed?.headers) ? parsed.headers : [];
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const detectedFields = getDetectedFields(headers);
  const parseErrors = Array.isArray(parsed?.parseErrors)
    ? [...parsed.parseErrors]
    : [];

  if (!detectedFields.latField || !detectedFields.lonField) {
    parseErrors.push(
      'Geo: Could not auto-detect latitude/longitude columns. Choose them manually.',
    );
  }

  return {
    id: createDatasetId(),
    name: typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim().split(/[\\/]/).pop()
      : 'CSV file',
    size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : null,
    lastModified: entry.lastModified ?? null,
    headers,
    rows,
    previewRows: Array.isArray(parsed?.previewRows) ? parsed.previewRows : rows.slice(0, 25),
    totalRows: Number.isFinite(Number(parsed?.totalRows))
      ? Math.max(0, Math.trunc(Number(parsed.totalRows)))
      : rows.length,
    parseErrors,
    latField: detectedFields.latField ?? null,
    lonField: detectedFields.lonField ?? null,
    enabled: true,
  };
}

function toImportFileResult(dataset) {
  return {
    ok: true,
    fileName: dataset.name,
    datasetId: dataset.id,
    rowCount: dataset.totalRows,
    importedFeatureCount: dataset.rows.length,
    skippedRowCount: Math.max(0, dataset.totalRows - dataset.rows.length),
    warnings: dataset.parseErrors,
    detectedFields: getDetectedFields(dataset.headers),
  };
}

function createDatasetId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeExampleName(value) {
  const requested = String(value ?? '').trim();
  if (
    !/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*\.csv$/.test(requested) ||
    requested.includes('..')
  ) {
    return null;
  }
  return requested;
}

async function fetchExampleBlob({ requested, baseUrl, fetchImpl }) {
  if (typeof fetchImpl !== 'function') return null;
  const examplesBase = `${String(baseUrl ?? '/').replace(/\/?$/, '/')}examples/`;

  if (requested.includes('/')) {
    return fetchCsvBlob(fetchImpl, `${examplesBase}${requested}`);
  }

  const legacyBlob = await fetchCsvBlob(fetchImpl, `${examplesBase}${requested}`);
  if (legacyBlob) return legacyBlob;

  try {
    const response = await fetchImpl(`${examplesBase}examples-index.json`, {
      cache: 'no-cache',
    });
    if (!response?.ok) return null;
    const index = await response.json();
    const match = (Array.isArray(index?.files) ? index.files : []).find((path) => {
      const safePath = normalizeExampleName(path);
      return safePath?.split('/').pop()?.toLowerCase() === requested.toLowerCase();
    });
    return match ? fetchCsvBlob(fetchImpl, `${examplesBase}${match}`) : null;
  } catch {
    return null;
  }
}

async function fetchCsvBlob(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response?.ok) return null;
    const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) return null;
    const blob = await response.blob();
    const prefix = await blob.slice(0, 512).text();
    const trimmed = prefix.trimStart().toLowerCase();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
      return null;
    }
    return blob;
  } catch {
    return null;
  }
}

function toDataSourceFeature(feature) {
  // Keep legacy sourceFileId/sourceRowIndex while GeoMap still reads them.
  // Future UI cleanup can switch detail lookups to sourceRef directly.
  return {
    ...feature,
    sourceRef: getFeatureSourceRef(feature),
  };
}

function getFeatureSourceRef(feature) {
  if (!feature?.sourceFileId || feature.sourceRowIndex == null) {
    return null;
  }

  return {
    datasetId: feature.sourceFileId,
    rowIndex: feature.sourceRowIndex,
  };
}

function getSourceRow(files, sourceRef) {
  const dataset = getDataset(files, sourceRef?.datasetId);
  if (!dataset || sourceRef?.rowIndex == null) return null;

  return dataset.rows?.[sourceRef.rowIndex] ?? null;
}

function getDataset(files, datasetId) {
  if (!datasetId) return null;
  return files.find((file) => file.id === datasetId) ?? null;
}

function getTimelineSummary(files) {
  let yearMin = null;
  let yearMax = null;
  const timelineIndex = deriveMapFeaturesFromFiles({
    files,
    timeline: null,
  }).timelineIndex;

  for (const entry of timelineIndex.entries) {
    if (yearMin == null || entry.startYear < yearMin) yearMin = entry.startYear;
    if (yearMax == null || entry.endYear > yearMax) yearMax = entry.endYear;
  }

  if (yearMin == null || yearMax == null) return null;

  return { yearMin, yearMax };
}
