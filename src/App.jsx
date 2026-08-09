import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import GeoMap from "./components/GeoMap";
import CsvPanel from "./components/CsvPanel";
import { useTimelineFilterState } from "./components/useTimelineFilterState";
import { useMapToolsState } from "./components/useMapToolsState";
import { CsvPanelOverlay } from "./components/CsvPanelOverlay";
import { useCsvFileDrop } from "./components/useCsvFileDrop";
import { useExampleCsvFilesFromUrl } from "./components/useExampleCsvFilesFromUrl";
import { useTimelinePlayback } from "./components/useTimelinePlayback";
import { MarkerDetailsPanel } from "./components/MarkerDetailsPanel";
import { useRuntimeDataSource } from "./components/useRuntimeDataSource";
import {
  getFirstImportedDatasetId,
  mergeImportBatchResults,
} from "./data/importBatchAggregation";

const SQLITE_RENDER_BUDGET = 1000;

export default function App() {
  const {
    dataSource,
    initialization,
    capabilities: desktopCapabilities,
  } = useRuntimeDataSource();
  const usesViewportQueries = desktopCapabilities.groupedViewportResults;

  const {
    state: timelineState,
    patch: patchTimeline,
  } = useTimelineFilterState();
  const mapToolsApi = useMapToolsState();
  const timelinePlaybackApi = useTimelinePlayback({
    timelineState,
    onTimelinePatch: patchTimeline,
  });

  const desktopImportAvailable =
    initialization?.ok === true && desktopCapabilities.nativeFilePickerImport;
  const browserSqliteImportAvailable =
    initialization?.ok === true &&
    desktopCapabilities.browserFileImport;
  const desktopDroppedImportAvailable =
    initialization?.ok === true &&
    desktopCapabilities.droppedFileImport;
  const databaseImportAvailable =
    desktopImportAvailable || browserSqliteImportAvailable;
  const [desktopImportState, setDesktopImportState] = useState({
    status: "idle",
    summary: null,
    error: null,
    progress: null,
  });
  // One token invalidates both compact dataset metadata and viewport results
  // after any desktop database mutation.
  const [desktopDataRevision, setDesktopDataRevision] = useState(0);
  const [desktopDatasetState, setDesktopDatasetState] = useState({
    status: usesViewportQueries ? "loading" : "idle",
    datasets: [],
    error: null,
  });
  const [databaseSelectedId, setDatabaseSelectedId] = useState(null);
  const [databasePreviewState, setDatabasePreviewState] = useState({
    status: "idle",
    datasetId: null,
    rows: [],
    totalRows: 0,
    hasMore: false,
    error: null,
  });
  const previewRequestRef = React.useRef(0);
  const mapQueryRequestRef = React.useRef(0);
  const [desktopVisibilityState, setDesktopVisibilityState] = useState({
    pendingDatasetIds: [],
    error: null,
  });
  const [desktopRemovalState, setDesktopRemovalState] = useState({
    pendingDatasetIds: [],
    error: null,
  });
  const [databaseMappingState, setDatabaseMappingState] = useState({
    pendingDatasetId: null,
    error: null,
  });
  const [mapViewport, setMapViewport] = useState(null);

  useEffect(() => {
    if (!databaseImportAvailable || !desktopCapabilities.importProgress) {
      return undefined;
    }

    const unsubscribe = dataSource.subscribeImportProgress((progress) => {
      setDesktopImportState((current) => (
        current.status === "importing"
          ? { ...current, progress }
          : current
      ));
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [dataSource, databaseImportAvailable, desktopCapabilities.importProgress]);

  // App owns marker selection so the map and details panel share one lifecycle.
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [selectedMarkers, setSelectedMarkers] = useState([]);
  const [isMarkerPanelCollapsed, setIsMarkerPanelCollapsed] = useState(false);

  // The details panel uses the CSV panel's visible edge as its left position.
  const [csvPanelVisibleWidth, setCsvPanelVisibleWidth] = useState(420);
  const [desktopMapViewState, setDesktopMapViewState] = useState({
    status: "idle",
    result: null,
    error: null,
  });

  /** Hide a completed import message without affecting imported datasets. */
  const dismissImportMessage = useCallback(() => {
    setDesktopImportState((current) => (
      current.status === "importing"
        ? current
        : { status: "idle", summary: null, error: null, progress: null }
    ));
  }, []);

  /** Hide the current dataset-list error until a later load fails. */
  const dismissDatasetLoadError = useCallback(() => {
    setDesktopDatasetState((current) => ({
      ...current,
      status: current.datasets.length > 0 ? "loaded" : "idle",
      error: null,
    }));
  }, []);

  /** Hide the current dataset visibility error without changing visibility. */
  const dismissDatasetMutationError = useCallback(() => {
    setDesktopVisibilityState((current) => ({ ...current, error: null }));
  }, []);

  /** Hide the current removal error without changing any dataset. */
  const dismissDatasetRemovalError = useCallback(() => {
    setDesktopRemovalState((current) => ({ ...current, error: null }));
  }, []);

  /** Hide the current mapping error while preserving the last valid mapping. */
  const dismissDatasetMappingError = useCallback(() => {
    setDatabaseMappingState((current) => ({ ...current, error: null }));
  }, []);

  /** Hide the current query error while retaining the last successful map result. */
  const dismissDatasetQueryError = useCallback(() => {
    setDesktopMapViewState((current) => ({
      ...current,
      status: current.result ? "loaded" : "idle",
      error: null,
    }));
  }, []);

  /** Hide the current preview error without discarding loaded preview rows. */
  const dismissDatasetPreviewError = useCallback(() => {
    setDatabasePreviewState((current) => ({
      ...current,
      error: null,
    }));
  }, []);

  const messageDismissal = useMemo(() => ({
    import: dismissImportMessage,
    datasetLoad: dismissDatasetLoadError,
    datasetMutation: dismissDatasetMutationError,
    datasetRemoval: dismissDatasetRemovalError,
    datasetQuery: dismissDatasetQueryError,
    mapping: dismissDatasetMappingError,
    preview: dismissDatasetPreviewError,
  }), [
    dismissDatasetLoadError,
    dismissDatasetMappingError,
    dismissDatasetMutationError,
    dismissDatasetPreviewError,
    dismissDatasetQueryError,
    dismissDatasetRemovalError,
    dismissImportMessage,
  ]);
  const desktopSqliteMapAvailable =
    usesViewportQueries && desktopCapabilities.points;
  const desktopDatasetSummaryAvailable =
    usesViewportQueries;
  const desktopDatasetVisibilityAvailable =
    usesViewportQueries && desktopCapabilities.datasetVisibility;
  const desktopDatasetRemovalAvailable =
    usesViewportQueries && desktopCapabilities.datasetRemoval;

  useEffect(() => {
    if (
      !usesViewportQueries ||
      !desktopDatasetSummaryAvailable ||
      initialization == null
    ) {
      return undefined;
    }

    if (!initialization.ok) {
      setDesktopDatasetState((current) => ({
        ...current,
        status: "error",
        error: initialization.error?.message ?? "Could not initialize the selected data backend.",
      }));
      return undefined;
    }

    let canceled = false;

    dataSource.getDatasetSummary().then((summary) => {
      if (canceled) return;
      setDesktopDatasetState({
        status: "loaded",
        datasets: summary.datasets,
        timeline: summary.timeline ?? null,
        error: null,
      });
      setDatabaseSelectedId((current) => {
        if (!desktopCapabilities.datasetSelection) return null;
        if (summary.datasets.some((dataset) => dataset.id === current)) {
          return current;
        }
        return summary.selectedDatasetId ?? summary.datasets[0]?.id ?? null;
      });
    }).catch((error) => {
      if (canceled) return;
      setDesktopDatasetState((current) => ({
        ...current,
        status: "error",
        error: error?.message
          ? String(error.message)
          : "Could not load datasets.",
      }));
    });

    return () => {
      canceled = true;
    };
  }, [
    desktopDataRevision,
    desktopDatasetSummaryAvailable,
    desktopCapabilities.datasetSelection,
    dataSource,
    initialization,
    usesViewportQueries,
  ]);
  const desktopDatasetListState = desktopDatasetSummaryAvailable
    ? {
        ...desktopDatasetState,
        pendingDatasetIds: desktopVisibilityState.pendingDatasetIds,
        mutationError: desktopVisibilityState.error,
        pendingRemovalDatasetIds: desktopRemovalState.pendingDatasetIds,
        removalError: desktopRemovalState.error,
        queryError: desktopMapViewState.error,
      }
    : {
        status: "error",
        datasets: [],
        error: "The dataset list is unavailable.",
        pendingDatasetIds: [],
        mutationError: null,
        pendingRemovalDatasetIds: [],
        removalError: null,
        queryError: null,
      };

  /** Select one database dataset and invalidate preview requests for the old one. */
  const selectDatabaseDataset = useCallback(async (datasetId) => {
    if (!usesViewportQueries || !desktopCapabilities.datasetSelection) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const result = await dataSource.selectDataset(datasetId);
    if (result?.ok && previewRequestRef.current === requestId) {
      setDatabaseSelectedId(result.datasetId);
    }
  }, [dataSource, desktopCapabilities.datasetSelection, usesViewportQueries]);

  /** Load the first bounded preview page and reject stale dataset responses. */
  useEffect(() => {
    if (
      !usesViewportQueries ||
      !desktopCapabilities.previewPaging ||
      initialization?.ok !== true ||
      !databaseSelectedId
    ) {
      setDatabasePreviewState({
        status: "idle",
        datasetId: null,
        rows: [],
        totalRows: 0,
        hasMore: false,
        error: null,
      });
      return undefined;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setDatabasePreviewState({
      status: "loading",
      datasetId: databaseSelectedId,
      rows: [],
      totalRows: 0,
      hasMore: false,
      error: null,
    });

    dataSource.getPreviewPage({
      datasetId: databaseSelectedId,
      offset: 0,
      limit: 30,
    }).then((page) => {
      if (previewRequestRef.current !== requestId) return;
      setDatabasePreviewState({
        status: "loaded",
        datasetId: databaseSelectedId,
        rows: page.rows,
        totalRows: page.totalRows,
        hasMore: page.hasMore,
        error: null,
      });
    }).catch((error) => {
      if (previewRequestRef.current !== requestId) return;
      setDatabasePreviewState({
        status: "error",
        datasetId: databaseSelectedId,
        rows: [],
        totalRows: 0,
        hasMore: false,
        error: error?.message ? String(error.message) : "Could not load preview rows.",
      });
    });

    return () => {
      if (previewRequestRef.current === requestId) {
        previewRequestRef.current += 1;
      }
    };
  }, [
    dataSource,
    databaseSelectedId,
    desktopCapabilities.previewPaging,
    initialization,
    usesViewportQueries,
  ]);

  /** Append one deterministic preview page without reloading earlier rows. */
  const loadMoreDatabasePreview = useCallback(async () => {
    const current = databasePreviewState;
    if (current.status !== "loaded" || !current.hasMore || !current.datasetId) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setDatabasePreviewState((state) => ({ ...state, status: "loading-more" }));
    try {
      const page = await dataSource.getPreviewPage({
        datasetId: current.datasetId,
        offset: current.rows.length,
        limit: 30,
      });
      if (previewRequestRef.current !== requestId) return;
      setDatabasePreviewState({
        status: "loaded",
        datasetId: current.datasetId,
        rows: [...current.rows, ...page.rows],
        totalRows: page.totalRows,
        hasMore: page.hasMore,
        error: null,
      });
    } catch (error) {
      if (previewRequestRef.current !== requestId) return;
      setDatabasePreviewState({
        ...current,
        status: "loaded",
        error: error?.message ? String(error.message) : "Could not load more preview rows.",
      });
    }
  }, [dataSource, databasePreviewState]);

  const handleMarkerSelect = useCallback((marker, nearbyMarkers) => {
    // Selecting a marker always reveals its details, even after a collapse.
    setSelectedMarker(marker);
    setSelectedMarkers(
      Array.isArray(nearbyMarkers) && nearbyMarkers.length > 0
        ? nearbyMarkers
        : [marker],
    );
    setIsMarkerPanelCollapsed(false);
  }, []);

  const handleMarkerPanelCollapse = useCallback(() => {
    setIsMarkerPanelCollapsed((isCollapsed) => !isCollapsed);
  }, []);

  const handleMarkerPanelClose = useCallback(() => {
    // Clearing the selection unmounts both the panel and its collapsed control.
    setSelectedMarker(null);
    setSelectedMarkers([]);
    setIsMarkerPanelCollapsed(false);
  }, []);

  const updateDesktopDatasetEnabled = useCallback(async (datasetId, enabled) => {
    if (!desktopDatasetVisibilityAvailable) return;

    setDesktopVisibilityState((current) => ({
      pendingDatasetIds: current.pendingDatasetIds.includes(datasetId)
        ? current.pendingDatasetIds
        : [...current.pendingDatasetIds, datasetId],
      error: null,
    }));

    try {
      const result = await dataSource.setDatasetEnabled(
        datasetId,
        enabled,
      );
      if (!result.ok) {
        throw new Error("The selected CSV dataset is no longer available.");
      }

      setDesktopDatasetState((current) => ({
        ...current,
        datasets: current.datasets.map((dataset) => (
          dataset.id === datasetId
            ? { ...dataset, enabled }
            : dataset
        )),
      }));
      setSelectedMarker(null);
      setSelectedMarkers([]);
      setIsMarkerPanelCollapsed(false);
      setDesktopDataRevision((revision) => revision + 1);
      setDesktopVisibilityState((current) => ({
        pendingDatasetIds: current.pendingDatasetIds.filter(
          (pendingId) => pendingId !== datasetId,
        ),
        error: null,
      }));
    } catch (error) {
      setDesktopVisibilityState((current) => ({
        pendingDatasetIds: current.pendingDatasetIds.filter(
          (pendingId) => pendingId !== datasetId,
        ),
        error: error?.message
          ? String(error.message)
          : "Could not update dataset visibility.",
      }));
    }
  }, [dataSource, desktopDatasetVisibilityAvailable]);

  const removeDesktopDataset = useCallback(async (datasetId) => {
    if (!desktopDatasetRemovalAvailable) return;

    const dataset = desktopDatasetState.datasets.find(
      (item) => item.id === datasetId,
    );
    if (!dataset) {
      setDesktopRemovalState((current) => ({
        ...current,
        error: "The selected CSV dataset is no longer available.",
      }));
      return;
    }

    const confirmed = window.confirm(
      `Remove "${dataset.name}" and its imported data from this application? ` +
      "The original CSV file will not be changed.",
    );
    if (!confirmed) return;

    setDesktopRemovalState((current) => ({
      pendingDatasetIds: current.pendingDatasetIds.includes(datasetId)
        ? current.pendingDatasetIds
        : [...current.pendingDatasetIds, datasetId],
      error: null,
    }));

    try {
      const result = await dataSource.removeDataset(datasetId);
      if (!result.ok) {
        throw new Error("The selected CSV dataset is no longer available.");
      }

      setDesktopDatasetState((current) => ({
        ...current,
        datasets: current.datasets.filter((item) => item.id !== datasetId),
      }));
      setSelectedMarker(null);
      setSelectedMarkers([]);
      setIsMarkerPanelCollapsed(false);
      if (databaseSelectedId === datasetId) {
        previewRequestRef.current += 1;
        setDatabaseSelectedId(null);
      }
      setDesktopDataRevision((revision) => revision + 1);
      setDesktopRemovalState((current) => ({
        pendingDatasetIds: current.pendingDatasetIds.filter(
          (pendingId) => pendingId !== datasetId,
        ),
        error: null,
      }));
    } catch (error) {
      setDesktopRemovalState((current) => ({
        pendingDatasetIds: current.pendingDatasetIds.filter(
          (pendingId) => pendingId !== datasetId,
        ),
        error: error?.message
          ? String(error.message)
          : "Could not remove the CSV dataset.",
      }));
    }
  }, [
    desktopDatasetRemovalAvailable,
    desktopDatasetState.datasets,
    dataSource,
    databaseSelectedId,
  ]);

  /** Rebuild one dataset mapping while retaining its last valid UI state on failure. */
  const updateDatabaseMapping = useCallback(async (datasetId, mapping) => {
    if (!usesViewportQueries || !desktopCapabilities.datasetMapping) return;
    setDatabaseMappingState({ pendingDatasetId: datasetId, error: null });
    try {
      const result = await dataSource.updateDatasetMapping(datasetId, mapping);
      if (!result?.ok) {
        throw new Error(result?.error?.message ?? "Could not update coordinate mapping.");
      }
      setDesktopDatasetState((current) => ({
        ...current,
        datasets: current.datasets.map((dataset) => (
          dataset.id === datasetId ? { ...dataset, ...result.dataset } : dataset
        )),
      }));
      setSelectedMarker(null);
      setSelectedMarkers([]);
      setIsMarkerPanelCollapsed(false);
      setDesktopDataRevision((revision) => revision + 1);
      setDatabaseMappingState({ pendingDatasetId: null, error: null });
    } catch (error) {
      setDatabaseMappingState({
        pendingDatasetId: null,
        error: error?.message
          ? String(error.message)
          : "Could not update coordinate mapping.",
      });
    }
  }, [
    dataSource,
    desktopCapabilities.datasetMapping,
    usesViewportQueries,
  ]);

  // Native picker, browser picker, drop, and example imports share normalized
  // progress/results while the selected adapter owns its safe file boundary.
  const runDesktopImport = useCallback(async (importOperation) => {
    setDesktopImportState({
      status: "importing",
      summary: null,
      error: null,
      progress: null,
    });

    try {
      const result = await importOperation();

      if (result?.canceled) {
        setDesktopImportState({
          status: "canceled",
          summary: null,
          error: null,
          progress: null,
        });
        return;
      }

      if (result?.ok) {
        const firstImportedDatasetId = getFirstImportedDatasetId(result);
        if (firstImportedDatasetId) {
          setDatabaseSelectedId(firstImportedDatasetId);
        }
        setDesktopImportState({
          status: "imported",
          summary: result,
          error: null,
          progress: null,
        });
        setDesktopDataRevision((revision) => revision + 1);
        return;
      }

      setDesktopImportState({
        status: "error",
        summary: result ?? null,
        error: "No CSV files were imported.",
        progress: null,
      });
    } catch (error) {
      setDesktopImportState({
        status: "error",
        summary: null,
        error: error?.message ? String(error.message) : "Import failed.",
        progress: null,
      });
    }
  }, []);

  const importCsvToSqlite = useCallback(() => {
    if (!desktopImportAvailable) return undefined;
    return runDesktopImport(() => dataSource.importFromPicker());
  }, [dataSource, desktopImportAvailable, runDesktopImport]);

  /** Route browser File objects only to the already-selected SQLite backend. */
  const importBrowserCsvToSqlite = useCallback((browserFiles) => {
    if (!browserSqliteImportAvailable) return undefined;
    return runDesktopImport(() => dataSource.importBrowserFiles({
      files: Array.from(browserFiles ?? []),
    }));
  }, [browserSqliteImportAvailable, dataSource, runDesktopImport]);

  const importDroppedCsvFiles = useCallback((droppedFiles) => {
    if (!desktopDroppedImportAvailable) return undefined;
    return runDesktopImport(
      () => dataSource.importDroppedFiles({ files: droppedFiles }),
    );
  }, [dataSource, desktopDroppedImportAvailable, runDesktopImport]);

  const importDatabaseExamples = useCallback((names) => {
    if (!desktopCapabilities.exampleImport) return undefined;
    return runDesktopImport(async () => {
      const batches = [];
      for (const name of names) {
        batches.push(await dataSource.importExample({ name }));
      }
      return mergeImportBatchResults(batches);
    });
  }, [
    dataSource,
    desktopCapabilities.exampleImport,
    runDesktopImport,
  ]);

  useExampleCsvFilesFromUrl({
    importExampleFiles: initialization?.ok === true
      ? importDatabaseExamples
      : null,
  });

  const desktopDropEnabled =
    desktopDroppedImportAvailable && desktopImportState.status !== "importing";
  const csvFileDrop = useCsvFileDrop({
    onImportFiles: desktopDropEnabled ? importDroppedCsvFiles : null,
  });
  const fileDropAvailable = desktopDropEnabled;

  const desktopImport = useMemo(() => ({
    isAvailable: databaseImportAvailable,
    usesNativePicker: desktopImportAvailable,
    status: desktopImportState.status,
    summary: desktopImportState.summary,
    error: desktopImportState.error,
    progress: desktopImportState.progress,
    onImport: importCsvToSqlite,
  }), [
    databaseImportAvailable,
    desktopImportAvailable,
    desktopImportState.error,
    desktopImportState.progress,
    desktopImportState.status,
    desktopImportState.summary,
    importCsvToSqlite,
  ]);

  const enabledDatabaseIds = useMemo(
    () => desktopDatasetState.datasets
      .filter((dataset) => dataset.enabled)
      .map((dataset) => dataset.id),
    [desktopDatasetState.datasets],
  );
  const databaseTimelineQuery = useMemo(() => ({
    timelineEnabled: !!timelineState.timelineEnabled,
    startYear: timelineState.startYear ?? null,
    endYear: timelineState.endYear ?? null,
    yearMin: timelineState.yearMin ?? null,
    yearMax: timelineState.yearMax ?? null,
    dayFilterEnabled: !!timelineState.dayFilterEnabled,
    startDay: timelineState.startDay ?? null,
    endDay: timelineState.endDay ?? null,
  }), [
    timelineState.dayFilterEnabled,
    timelineState.endDay,
    timelineState.endYear,
    timelineState.startDay,
    timelineState.startYear,
    timelineState.timelineEnabled,
    timelineState.yearMax,
    timelineState.yearMin,
  ]);

  /** Debounce viewport work and allow only the newest query to update the map. */
  useEffect(() => {
    if (
      !desktopSqliteMapAvailable ||
      initialization?.ok !== true ||
      !mapViewport?.bounds
    ) {
      return undefined;
    }

    const requestId = mapQueryRequestRef.current + 1;
    mapQueryRequestRef.current = requestId;
    setDesktopMapViewState((current) => ({
      ...current,
      status: current.result ? "refreshing" : "loading",
      error: null,
    }));
    const timerId = globalThis.setTimeout(() => {
      dataSource.queryMapView({
        bounds: mapViewport.bounds,
        zoom: mapViewport.zoom ?? null,
        timeline: databaseTimelineQuery,
        renderBudget: SQLITE_RENDER_BUDGET,
        datasetIds: enabledDatabaseIds,
      }).then((result) => {
        if (mapQueryRequestRef.current === requestId) {
          setDesktopMapViewState({ status: "loaded", result, error: null });
        }
      }).catch((error) => {
        if (mapQueryRequestRef.current === requestId) {
          setDesktopMapViewState((current) => ({
            ...current,
            status: "error",
            error: error?.message ? String(error.message) : "Map query failed.",
          }));
        }
      });
    }, 100);

    return () => {
      globalThis.clearTimeout(timerId);
    };
  }, [
    dataSource,
    desktopSqliteMapAvailable,
    desktopDataRevision,
    databaseTimelineQuery,
    enabledDatabaseIds,
    initialization,
    mapViewport,
  ]);

  const desktopMapFeatures = useMemo(
    () => toLegacyMapFeatures(desktopMapViewState.result),
    [desktopMapViewState.result],
  );
  const activeMapFeatures = desktopMapFeatures;
  const viewportQueryStats = desktopMapViewState.result?.stats ?? null;
  // Compact SQLite results load complete source rows only on demand.
  const getDesktopFeatureDetails = useCallback(
    (query) => dataSource.getFeatureDetails(query),
    [dataSource],
  );
  const activeFeatureDetailsLoader = desktopSqliteMapAvailable
    ? getDesktopFeatureDetails
    : null;
  const getDesktopGroupRows = useCallback(
    (query) => dataSource.getGroupRows(query),
    [dataSource],
  );
  const activeGroupRowsLoader = desktopSqliteMapAvailable
    ? getDesktopGroupRows
    : null;
  const getCompleteLogicalZone = useCallback(
    (query) => dataSource.getLogicalZone(query),
    [dataSource],
  );
  const updateCompleteLogicalZone = useCallback(async (request) => {
    const result = await dataSource.updateLogicalZone(request);
    // One revision refreshes the viewport from committed SQLite geometry.
    setDesktopDataRevision((revision) => revision + 1);
    return result;
  }, [dataSource]);
  const reportZoneEditingError = useCallback((error) => {
    setDesktopMapViewState((current) => ({
      ...current,
      status: current.result ? "loaded" : "error",
      error: error?.message
        ? String(error.message)
        : "Could not update the selected zone.",
    }));
  }, []);
  const setZoneEditingEnabled = useCallback((enabled) => {
    mapToolsApi.patch({ zoneEditingEnabled: enabled === true });
  }, [mapToolsApi]);
  const databaseFiles = useMemo(() => desktopDatasetState.datasets.map((dataset) => ({
    ...dataset,
    size: dataset.sizeBytes,
    rows: dataset.id === databaseSelectedId ? databasePreviewState.rows : [],
    previewStatus: dataset.id === databaseSelectedId
      ? databasePreviewState.status
      : "idle",
    previewError: dataset.id === databaseSelectedId
      ? databasePreviewState.error
      : null,
    previewHasMore: dataset.id === databaseSelectedId && databasePreviewState.hasMore,
    previewTotalRows: dataset.id === databaseSelectedId
      ? databasePreviewState.totalRows
      : dataset.rowCount,
  })), [
    databasePreviewState,
    databaseSelectedId,
    desktopDatasetState.datasets,
  ]);
  const databaseSelected = useMemo(
    () => databaseFiles.find((dataset) => dataset.id === databaseSelectedId) ?? null,
    [databaseFiles, databaseSelectedId],
  );
  const timelineFields = useMemo(() => ({
    yearField: databaseSelected?.detectedFields?.yearField ?? null,
    dateField: databaseSelected?.detectedFields?.dateField ?? null,
    dayOfYearField: databaseSelected?.detectedFields?.dayOfYearField ?? null,
  }), [databaseSelected?.detectedFields]);

  return (
    <div
      className="appRoot"
      onDragEnter={fileDropAvailable ? csvFileDrop.handleDragEnter : undefined}
      onDragOver={fileDropAvailable ? csvFileDrop.handleDragOver : undefined}
      onDragLeave={fileDropAvailable ? csvFileDrop.handleDragLeave : undefined}
      onDrop={fileDropAvailable ? csvFileDrop.handleDrop : undefined}
    >
      {fileDropAvailable && csvFileDrop.isDraggingFiles && (
        <div className="dropOverlay" aria-hidden="true">
          <div className="dropOverlayText">Drop CSV to import</div>
        </div>
      )}
      <div className="rightPane">
        <GeoMap
          points={activeMapFeatures.points.points}
          regions={activeMapFeatures.regions.polygons}
          lines={activeMapFeatures.lines.lines}
          getSourceRow={activeMapFeatures.getSourceRow}
          getFeatureDetails={activeFeatureDetailsLoader}
          clusterMarkersEnabled={!!mapToolsApi.state.clusterMarkersEnabled}
          clusterRadius={mapToolsApi.state.clusterRadius}
          onViewportChange={setMapViewport}
          onMarkerSelect={handleMarkerSelect}
          selectedMarker={selectedMarker}
          zoneEditingEnabled={
            desktopCapabilities.zoneEditing && !!mapToolsApi.state.zoneEditingEnabled
          }
          onZoneEditingToggle={desktopCapabilities.zoneEditing
            ? setZoneEditingEnabled
            : undefined}
          getLogicalZone={desktopCapabilities.zoneEditing
            ? getCompleteLogicalZone
            : undefined}
          updateLogicalZone={desktopCapabilities.zoneEditing
            ? updateCompleteLogicalZone
            : undefined}
          enabledDatasetIds={enabledDatabaseIds}
          onZoneEditingError={reportZoneEditingError}
        />

        <CsvPanelOverlay onVisibleWidthChange={setCsvPanelVisibleWidth}>
          <CsvPanel
            files={databaseFiles}
            selectedId={databaseSelectedId}
            onSelect={desktopCapabilities.datasetSelection
              ? selectDatabaseDataset
              : undefined}
            onImportFiles={browserSqliteImportAvailable
              ? importBrowserCsvToSqlite
              : undefined}
            desktopImport={desktopImport}
            datasetListState={desktopDatasetListState}
            viewportQueryStats={viewportQueryStats}
            onUnloadFile={desktopDatasetRemovalAvailable
              ? removeDesktopDataset
              : undefined}
            removeActionLabel="Remove"
            onToggleEnabled={desktopDatasetVisibilityAvailable
              ? updateDesktopDatasetEnabled
              : undefined}
            onUpdateMapping={desktopCapabilities.datasetMapping
              ? updateDatabaseMapping
              : undefined}
            onLoadMorePreview={desktopCapabilities.previewPaging
              ? loadMoreDatabasePreview
              : undefined}
            initialization={initialization ?? { ok: false }}
            mappingState={databaseMappingState}
            messageDismissal={messageDismissal}
            timelineState={timelineState}
            timelineFields={timelineFields}
            onTimelinePatch={patchTimeline}
            onTimelinePlaybackStart={timelinePlaybackApi.startPlayback}
            onTimelinePlaybackStop={timelinePlaybackApi.stopPlayback}
            timelineStats={{
              skippedByTimeline:
                (activeMapFeatures.points.skippedByTimeline ?? 0) +
                (activeMapFeatures.regions.skippedByTimeline ?? 0) +
                (activeMapFeatures.lines.skippedByTimeline ?? 0),
            }}
            mapToolsState={mapToolsApi.state}
            onMapToolsPatch={mapToolsApi.patch}
          />
        </CsvPanelOverlay>

        <MarkerDetailsPanel
          marker={selectedMarker}
          markers={selectedMarkers}
          leftOffset={csvPanelVisibleWidth}
          getSourceRow={activeMapFeatures.getSourceRow}
          getFeatureDetails={activeFeatureDetailsLoader}
          getGroupRows={activeGroupRowsLoader}
          isCollapsed={isMarkerPanelCollapsed}
          onToggleCollapse={handleMarkerPanelCollapse}
          onClose={handleMarkerPanelClose}
        />
      </div>
    </div>
  );
}

function toLegacyMapFeatures(mapView) {
  return {
    points: {
      points: mapView?.points ?? [],
      skipped: mapView?.stats?.skippedPoints ?? 0,
      skippedByTimeline: mapView?.stats?.skippedPointsByTimeline ?? 0,
    },
    lines: {
      lines: mapView?.lines ?? [],
      skipped: mapView?.stats?.skippedLines ?? 0,
      skippedByTimeline: mapView?.stats?.skippedLinesByTimeline ?? 0,
    },
    regions: {
      polygons: mapView?.regions ?? [],
      skipped: mapView?.stats?.skippedRegions ?? 0,
      skippedByTimeline: mapView?.stats?.skippedRegionsByTimeline ?? 0,
    },
    getSourceRow: () => null,
    timelineIndex: mapView?.timelineIndex ?? { entries: [] },
    stats: mapView?.stats ?? null,
  };
}
