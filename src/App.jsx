import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import GeoMap from "./components/GeoMap";
import CsvPanel from "./components/CsvPanel";
import { useCsvFiles } from "./components/useCsvFiles";
import { useTimelineFilterState } from "./components/useTimelineFilterState";
import {
  autoDetectRangeFields,
  autoDetectTimelineFields,
  tryGetYear,
} from "./components/timeline";
import { getRangeYear } from "./components/csvFeatureValueHelpers";
import { useMapToolsState } from "./components/useMapToolsState";
import { useDerivedMapFeatures } from "./components/useDerivedMapFeatures";
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

const LARGE_RAW_MARKER_WARNING_THRESHOLD = 3000;
const SQLITE_RENDER_BUDGET = 1000;

export default function App() {
  const {
    dataSource,
    dataRevision,
    initialization,
    capabilities: desktopCapabilities,
    workflow,
  } = useRuntimeDataSource();
  const usesBrowserFiles = workflow.rawBrowserFiles;
  const usesViewportQueries = workflow.viewportQueries;

  /**
   * CSV file state and actions.
   * - files: all loaded CSV files
   * - selectedId: currently selected CSV file ID
   * - selected: the selected CSV file object (or null)
   * - importFiles: load new CSV files
   * - unloadSelected: remove the selected CSV file
   * - unloadFile: remove a CSV file by ID
   * - updateFileEnabled: toggle file visibility on the map
   * - updateFileMapping: update lat/lon mapping for a file
   */
  const {
    files,
    selectedId,
    selected,
    setSelectedId,
    importFiles,
    importDroppedFiles,
    unloadSelected,
    updateFileMapping,
    importExampleFile,
    unloadFile,
    updateFileEnabled,
  } = useCsvFiles({
    dataSource,
    dataRevision,
    enabled: usesBrowserFiles,
  });

  const {
    state: timelineState,
    patch: patchTimeline,
    setYearRange,
  } = useTimelineFilterState();
  const mapToolsApi = useMapToolsState();
  const timelinePlaybackApi = useTimelinePlayback({
    timelineState,
    onTimelinePatch: patchTimeline,
  });

  const derivedMapFeatures = useDerivedMapFeatures({
    dataSource,
    dataRevision,
    enabled: usesBrowserFiles,
    timeline: timelineState,
  });

  const desktopImportAvailable =
    initialization?.ok === true && desktopCapabilities.nativeFilePickerImport;
  const browserSqliteImportAvailable =
    usesViewportQueries &&
    initialization?.ok === true &&
    desktopCapabilities.browserFileImport;
  const desktopDroppedImportAvailable =
    usesViewportQueries &&
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
  const [isMarkerPanelCollapsed, setIsMarkerPanelCollapsed] = useState(false);

  // The details panel uses the CSV panel's visible edge as its left position.
  const [csvPanelVisibleWidth, setCsvPanelVisibleWidth] = useState(420);
  const [desktopMapViewState, setDesktopMapViewState] = useState({
    status: "idle",
    result: null,
    error: null,
  });
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

  const handleMarkerSelect = useCallback((marker) => {
    // Selecting a marker always reveals its details, even after a collapse.
    setSelectedMarker(marker);
    setIsMarkerPanelCollapsed(false);
  }, []);

  const handleMarkerPanelCollapse = useCallback(() => {
    setIsMarkerPanelCollapsed((isCollapsed) => !isCollapsed);
  }, []);

  const handleMarkerPanelClose = useCallback(() => {
    // Clearing the selection unmounts both the panel and its collapsed control.
    setSelectedMarker(null);
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
    if (!usesViewportQueries || !desktopCapabilities.exampleImport) return undefined;
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
    usesViewportQueries,
  ]);

  useExampleCsvFilesFromUrl({
    importExampleFile: usesBrowserFiles ? importExampleFile : null,
    importExampleFiles: !usesBrowserFiles && initialization?.ok === true
      ? importDatabaseExamples
      : null,
  });

  const desktopDropEnabled =
    desktopDroppedImportAvailable && desktopImportState.status !== "importing";
  const csvFileDrop = useCsvFileDrop({
    onImportFiles: usesBrowserFiles
      ? importDroppedFiles
      : (desktopDropEnabled ? importDroppedCsvFiles : null),
  });
  const fileDropAvailable = usesBrowserFiles || desktopDropEnabled;

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
  const databaseTimelineAvailable = !!desktopDatasetState.timeline;
  const databaseTimelineQuery = useMemo(() => ({
    timelineEnabled:
      databaseTimelineAvailable && !!timelineState.timelineEnabled,
    startYear: timelineState.startYear ?? null,
    endYear: timelineState.endYear ?? null,
    yearMin: timelineState.yearMin ?? null,
    yearMax: timelineState.yearMax ?? null,
    dayFilterEnabled: !!timelineState.dayFilterEnabled,
    startDay: timelineState.startDay ?? null,
    endDay: timelineState.endDay ?? null,
  }), [
    databaseTimelineAvailable,
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
  // Database-backed sessions never fall back to renderer in-memory CSV data.
  const activeMapFeatures = usesViewportQueries
    ? desktopMapFeatures
    : derivedMapFeatures;
  const viewportQueryStats = usesViewportQueries
    ? desktopMapViewState.result?.stats ?? null
    : null;
  // Compact database results load source rows on demand; raw browser data keeps
  // its existing synchronous row lookup.
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
  const activeSelected = usesViewportQueries ? databaseSelected : selected;
  const selectedHeaders = activeSelected?.headers;
  const selectedRows = usesViewportQueries ? null : selected?.rows;
  const visibleMarkerPointCount = useMemo(
    () => activeMapFeatures.points.points.filter((point) => !point.image).length,
    [activeMapFeatures.points.points],
  );

  // Warn before disabling clustering when raw marker rendering is likely to be expensive.
  const patchMapToolsWithSafeguards = useCallback((partial) => {
    const disablingClusterMarkers =
      partial?.clusterMarkersEnabled === false &&
      !!mapToolsApi.state.clusterMarkersEnabled;

    if (
      disablingClusterMarkers &&
      visibleMarkerPointCount > LARGE_RAW_MARKER_WARNING_THRESHOLD
    ) {
      const confirmed = window.confirm(
        `This will render ${visibleMarkerPointCount.toLocaleString()} individual markers and may slow down the browser. Continue?`,
      );

      if (!confirmed) return;
    }

    mapToolsApi.patch(partial);
  }, [
    mapToolsApi,
    visibleMarkerPointCount,
  ]);

  const timelineFields = useMemo(() => {
    if (usesViewportQueries) {
      return {
        yearField: activeSelected?.detectedFields?.yearField ?? null,
        dateField: activeSelected?.detectedFields?.dateField ?? null,
        dayOfYearField: activeSelected?.detectedFields?.dayOfYearField ?? null,
      };
    }
    if (!selectedHeaders) {
      return { yearField: null, dateField: null, dayOfYearField: null };
    }
    return autoDetectTimelineFields(selectedHeaders);
  }, [activeSelected?.detectedFields, selectedHeaders, usesViewportQueries]);

  const timelineRangeFields = useMemo(() => {
    if (usesViewportQueries) {
      return {
        yearFromField: activeSelected?.detectedFields?.yearFromField ?? null,
        yearToField: activeSelected?.detectedFields?.yearToField ?? null,
        dateFromField: activeSelected?.detectedFields?.dateFromField ?? null,
        dateToField: activeSelected?.detectedFields?.dateToField ?? null,
      };
    }
    if (!selectedHeaders) {
      return {
        yearFromField: null,
        yearToField: null,
        dateFromField: null,
        dateToField: null,
      };
    }
    return autoDetectRangeFields(selectedHeaders);
  }, [activeSelected?.detectedFields, selectedHeaders, usesViewportQueries]);

  // SQLite exposes only a compact enabled-dataset timeline extent; React must
  // not load all source rows merely to initialize the year controls.
  useEffect(() => {
    if (!usesViewportQueries || !timelineState.timelineEnabled) return;
    if (timelineState.yearDomainMode === "manual") return;
    const min = desktopDatasetState.timeline?.yearMin ?? null;
    const max = desktopDatasetState.timeline?.yearMax ?? null;
    patchTimeline({
      yearMin: min,
      yearMax: max,
      yearMinDraft: String(min ?? ""),
      yearMaxDraft: String(max ?? ""),
    });
    if (min == null || max == null) return;
    const nextStart = timelineState.startYear == null
      ? min
      : Math.max(min, Math.min(max, timelineState.startYear));
    const nextEnd = timelineState.endYear == null
      ? max
      : Math.max(min, Math.min(max, timelineState.endYear));
    const start = Math.min(nextStart, nextEnd);
    const end = Math.max(nextStart, nextEnd);
    if (start !== timelineState.startYear || end !== timelineState.endYear) {
      setYearRange(start, end);
    }
  }, [
    desktopDatasetState.timeline,
    patchTimeline,
    setYearRange,
    timelineState.endYear,
    timelineState.startYear,
    timelineState.timelineEnabled,
    timelineState.yearDomainMode,
    usesViewportQueries,
  ]);

  // When timeline is enabled, compute year domain from selected file
  useEffect(() => {
    if (usesViewportQueries || !selectedRows) return;
    if (!timelineState.timelineEnabled) return;

    // if user has set a manual year domain, do not overwrite it from data
    if (timelineState.yearDomainMode === "manual") return;

    let min = null;
    let max = null;

    for (const r of selectedRows) {
      const extent = getRowTimelineExtent(
        r,
        timelineFields,
        timelineRangeFields,
      );
      if (!extent) continue;

      if (min == null || extent.min < min) min = extent.min;
      if (max == null || extent.max > max) max = extent.max;
    }

    patchTimeline({
      yearMin: min,
      yearMax: max,
      // Keep the Min/Max input boxes in sync while in auto mode
      yearMinDraft: String(min ?? ""),
      yearMaxDraft: String(max ?? ""),
    });

    const s = timelineState.startYear;
    const e = timelineState.endYear;

    if (min != null && max != null) {
      const nextStart = s == null ? min : Math.max(min, Math.min(max, s));
      const nextEnd = e == null ? max : Math.max(min, Math.min(max, e));

      const finalStart = Math.min(nextStart, nextEnd);
      const finalEnd = Math.max(nextStart, nextEnd);

      if (finalStart !== s || finalEnd !== e) {
        setYearRange(finalStart, finalEnd);
      }
    }
  }, [
    selected?.id,
    selectedRows,
    timelineState.timelineEnabled,
    timelineState.yearDomainMode,
    timelineState.startYear,
    timelineState.endYear,
    timelineFields,
    timelineRangeFields,
    patchTimeline,
    setYearRange,
    usesViewportQueries,
  ]);

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
        />

        <CsvPanelOverlay onVisibleWidthChange={setCsvPanelVisibleWidth}>
          <CsvPanel
            files={usesViewportQueries ? databaseFiles : files}
            selectedId={usesViewportQueries ? databaseSelectedId : selectedId}
            onSelect={usesViewportQueries
              ? (desktopCapabilities.datasetSelection
                  ? selectDatabaseDataset
                  : undefined)
              : setSelectedId}
            onImportFiles={usesBrowserFiles
              ? importFiles
              : (browserSqliteImportAvailable
                  ? importBrowserCsvToSqlite
                  : undefined)}
            desktopImport={desktopImport}
            datasetListState={usesViewportQueries ? desktopDatasetListState : null}
            viewportQueryStats={viewportQueryStats}
            onUnloadSelected={usesViewportQueries ? undefined : unloadSelected}
            onUnloadFile={usesViewportQueries
              ? (desktopDatasetRemovalAvailable
                  ? removeDesktopDataset
                  : undefined)
              : unloadFile}
            removeActionLabel={usesViewportQueries ? "Remove" : "Unload"}
            onToggleEnabled={usesViewportQueries
              ? (desktopDatasetVisibilityAvailable
                  ? updateDesktopDatasetEnabled
                  : undefined)
              : updateFileEnabled}
            onUpdateMapping={usesViewportQueries
              ? (desktopCapabilities.datasetMapping
                  ? updateDatabaseMapping
                  : undefined)
              : updateFileMapping}
            onLoadMorePreview={usesViewportQueries && desktopCapabilities.previewPaging
              ? loadMoreDatabasePreview
              : undefined}
            initialization={usesViewportQueries
              ? (initialization ?? { ok: false })
              : null}
            mappingState={usesViewportQueries ? databaseMappingState : null}
            timelineState={timelineState}
            timelineAvailable={usesViewportQueries
              ? databaseTimelineAvailable
              : true}
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
            onMapToolsPatch={patchMapToolsWithSafeguards}
          />
        </CsvPanelOverlay>

        <MarkerDetailsPanel
          marker={selectedMarker}
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

/**
 * Compute the year extent of a CSV row for timeline domain detection.
 *
 * Semantics:
 * - If a range is present (yearFrom/yearTo or dateFrom/dateTo),
 *   the row contributes a [min, max] range.
 * - If only one bound exists, it is treated as a single-year range.
 * - Otherwise, fall back to a single point-in-time year/date field.
 */
function getRowTimelineExtent(row, timelineFields, rangeFields) {
  const yearFrom = getRangeYear(
    row,
    rangeFields?.yearFromField,
    rangeFields?.dateFromField,
  );
  const yearTo = getRangeYear(
    row,
    rangeFields?.yearToField,
    rangeFields?.dateToField,
  );

  // Prefer range semantics when any range bound is present
  if (yearFrom != null || yearTo != null) {
    const from = yearFrom ?? yearTo;
    const to = yearTo ?? yearFrom;
    if (from == null || to == null) return null;

    return {
      min: Math.min(from, to),
      max: Math.max(from, to),
    };
  }

  // Fall back to point-in-time year/date
  const year = tryGetYear(row, timelineFields);
  if (year == null) return null;

  return { min: year, max: year };
}
