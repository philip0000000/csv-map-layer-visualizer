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
import { createDesktopSqliteDataSource } from "./data/desktopSqliteDataSource";
import { MarkerDetailsPanel } from "./components/MarkerDetailsPanel";

const LARGE_RAW_MARKER_WARNING_THRESHOLD = 3000;
const SQLITE_RENDER_BUDGET = 1000;

export default function App() {
  // Electron exposes this object in desktop mode only. Browser builds will not have it.
  const desktopApi = useMemo(() => globalThis.csvMapDesktop ?? null, []);
  const isDesktop = desktopApi?.isDesktop === true;

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
    unloadSelected,
    updateFileMapping,
    importExampleFile,
    unloadFile,
    updateFileEnabled,
  } = useCsvFiles();

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
    files,
    timeline: timelineState,
  });

  useExampleCsvFilesFromUrl({
    importExampleFile: isDesktop ? null : importExampleFile,
  });
  const desktopImportAvailable =
    isDesktop && typeof desktopApi.importCsvToSqlite === "function";
  const desktopDroppedImportAvailable =
    isDesktop && typeof desktopApi.importDroppedCsvFiles === "function";
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
    status: isDesktop ? "loading" : "idle",
    datasets: [],
    error: null,
  });
  const [desktopVisibilityState, setDesktopVisibilityState] = useState({
    pendingDatasetIds: [],
    error: null,
  });
  const [desktopRemovalState, setDesktopRemovalState] = useState({
    pendingDatasetIds: [],
    error: null,
  });
  const [mapViewport, setMapViewport] = useState(null);

  useEffect(() => {
    if (!isDesktop || typeof desktopApi?.onCsvImportProgress !== "function") {
      return undefined;
    }

    const unsubscribe = desktopApi.onCsvImportProgress((progress) => {
      const normalizedProgress = normalizeDesktopImportProgress(progress);
      if (!normalizedProgress) return;

      setDesktopImportState((current) => (
        current.status === "importing"
          ? { ...current, progress: normalizedProgress }
          : current
      ));
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [desktopApi, isDesktop]);

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
    isDesktop && typeof desktopApi?.queryMapView === "function";
  const desktopDatasetSummaryAvailable =
    isDesktop && typeof desktopApi?.getDatasetSummary === "function";
  const desktopDatasetVisibilityAvailable =
    isDesktop && typeof desktopApi?.setDatasetEnabled === "function";
  const desktopDatasetRemovalAvailable =
    isDesktop && typeof desktopApi?.removeDataset === "function";
  const desktopSqliteDataSource = useMemo(
    () => createDesktopSqliteDataSource({ desktopApi }),
    [desktopApi],
  );

  useEffect(() => {
    if (!isDesktop || !desktopDatasetSummaryAvailable) return undefined;

    let canceled = false;

    desktopSqliteDataSource.getDatasetSummary().then((summary) => {
      if (canceled) return;
      setDesktopDatasetState({
        status: "loaded",
        datasets: summary.datasets,
        error: null,
      });
    }).catch((error) => {
      if (canceled) return;
      setDesktopDatasetState((current) => ({
        ...current,
        status: "error",
        error: error?.message
          ? String(error.message)
          : "Could not load desktop datasets.",
      }));
    });

    return () => {
      canceled = true;
    };
  }, [
    desktopDataRevision,
    desktopDatasetSummaryAvailable,
    desktopSqliteDataSource,
    isDesktop,
  ]);
  const desktopDatasetListState = desktopDatasetSummaryAvailable
    ? {
        ...desktopDatasetState,
        pendingDatasetIds: desktopVisibilityState.pendingDatasetIds,
        mutationError: desktopVisibilityState.error,
        pendingRemovalDatasetIds: desktopRemovalState.pendingDatasetIds,
        removalError: desktopRemovalState.error,
      }
    : {
        status: "error",
        datasets: [],
        error: "The desktop dataset list is unavailable.",
        pendingDatasetIds: [],
        mutationError: null,
        pendingRemovalDatasetIds: [],
        removalError: null,
      };

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
      const result = await desktopSqliteDataSource.setDatasetEnabled(
        datasetId,
        enabled,
      );
      if (!result.updated) {
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
  }, [desktopDatasetVisibilityAvailable, desktopSqliteDataSource]);

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
      const result = await desktopSqliteDataSource.removeDataset(datasetId);
      if (!result.removed) {
        throw new Error("The selected CSV dataset is no longer available.");
      }

      setDesktopDatasetState((current) => ({
        ...current,
        datasets: current.datasets.filter((item) => item.id !== datasetId),
      }));
      setSelectedMarker(null);
      setIsMarkerPanelCollapsed(false);
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
    desktopSqliteDataSource,
  ]);

  // Picker and drop imports share state handling while the main process owns
  // file access and per-file database transactions.
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
    return runDesktopImport(() => desktopApi.importCsvToSqlite());
  }, [desktopApi, desktopImportAvailable, runDesktopImport]);

  const importDroppedCsvFiles = useCallback((droppedFiles) => {
    if (!desktopDroppedImportAvailable) return undefined;
    return runDesktopImport(
      () => desktopApi.importDroppedCsvFiles(droppedFiles),
    );
  }, [desktopApi, desktopDroppedImportAvailable, runDesktopImport]);

  const desktopDropEnabled =
    desktopDroppedImportAvailable && desktopImportState.status !== "importing";
  const csvFileDrop = useCsvFileDrop({
    onImportFiles: isDesktop
      ? (desktopDropEnabled ? importDroppedCsvFiles : null)
      : importFiles,
  });
  const fileDropAvailable = !isDesktop || desktopDropEnabled;

  const desktopImport = useMemo(() => ({
    isAvailable: desktopImportAvailable,
    status: desktopImportState.status,
    summary: desktopImportState.summary,
    error: desktopImportState.error,
    progress: desktopImportState.progress,
    onImport: importCsvToSqlite,
  }), [
    desktopImportAvailable,
    desktopImportState.error,
    desktopImportState.progress,
    desktopImportState.status,
    desktopImportState.summary,
    importCsvToSqlite,
  ]);

  useEffect(() => {
    if (!desktopSqliteMapAvailable || !mapViewport?.bounds) {
      return undefined;
    }

    let canceled = false;

    desktopSqliteDataSource.queryMapView({
      bounds: mapViewport.bounds,
      zoom: mapViewport.zoom ?? null,
      timeline: timelineState,
      renderBudget: SQLITE_RENDER_BUDGET,
    }).then((result) => {
      if (!canceled) {
        setDesktopMapViewState({ status: "loaded", result, error: null });
      }
    }).catch((error) => {
      if (!canceled) {
        setDesktopMapViewState({
          status: "error",
          result: null,
          error: error?.message ? String(error.message) : "Map query failed.",
        });
      }
    });

    return () => {
      canceled = true;
    };
  }, [
    desktopSqliteDataSource,
    desktopSqliteMapAvailable,
    desktopDataRevision,
    mapViewport,
    timelineState,
  ]);

  const desktopMapFeatures = useMemo(
    () => toLegacyMapFeatures(desktopMapViewState.result),
    [desktopMapViewState.result],
  );
  // Desktop never falls back to the renderer's in-memory CSV data source.
  const activeMapFeatures = isDesktop ? desktopMapFeatures : derivedMapFeatures;
  const viewportQueryStats = isDesktop
    ? desktopMapViewState.result?.stats ?? null
    : null;
  // Detail loaders are desktop-only, so browser and in-memory maps keep their old path.
  const getDesktopFeatureDetails = useCallback(
    (query) => desktopSqliteDataSource.getFeatureDetails(query),
    [desktopSqliteDataSource],
  );
  const activeFeatureDetailsLoader = desktopSqliteMapAvailable
    ? getDesktopFeatureDetails
    : null;
  const getDesktopGroupRows = useCallback(
    (query) => desktopSqliteDataSource.getGroupRows(query),
    [desktopSqliteDataSource],
  );
  const activeGroupRowsLoader = desktopSqliteMapAvailable
    ? getDesktopGroupRows
    : null;
  const selectedHeaders = selected?.headers;
  const selectedRows = selected?.rows;
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
    if (!selectedHeaders) {
      return { yearField: null, dateField: null, dayOfYearField: null };
    }
    return autoDetectTimelineFields(selectedHeaders);
  }, [selectedHeaders]);

  const timelineRangeFields = useMemo(() => {
    if (!selectedHeaders) {
      return {
        yearFromField: null,
        yearToField: null,
        dateFromField: null,
        dateToField: null,
      };
    }
    return autoDetectRangeFields(selectedHeaders);
  }, [selectedHeaders]);

  // When timeline is enabled, compute year domain from selected file
  useEffect(() => {
    if (!selectedRows) return;
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
          clusterMarkersEnabled={!!mapToolsApi.state.clusterMarkersEnabled}
          clusterRadius={mapToolsApi.state.clusterRadius}
          onViewportChange={setMapViewport}
          onMarkerSelect={handleMarkerSelect}
          selectedMarker={selectedMarker}
        />

        <CsvPanelOverlay onVisibleWidthChange={setCsvPanelVisibleWidth}>
          <CsvPanel
            files={isDesktop ? desktopDatasetListState.datasets : files}
            selectedId={isDesktop ? null : selectedId}
            onSelect={isDesktop ? undefined : setSelectedId}
            onImportFiles={isDesktop ? undefined : importFiles}
            desktopImport={desktopImport}
            datasetListState={isDesktop ? desktopDatasetListState : null}
            viewportQueryStats={viewportQueryStats}
            onUnloadSelected={isDesktop ? undefined : unloadSelected}
            onUnloadFile={isDesktop
              ? (desktopDatasetRemovalAvailable
                  ? removeDesktopDataset
                  : undefined)
              : unloadFile}
            removeActionLabel={isDesktop ? "Remove" : "Unload"}
            onToggleEnabled={isDesktop
              ? (desktopDatasetVisibilityAvailable
                  ? updateDesktopDatasetEnabled
                  : undefined)
              : updateFileEnabled}
            onUpdateMapping={isDesktop ? undefined : updateFileMapping}
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

function normalizeDesktopImportProgress(progress) {
  if (!progress || typeof progress !== "object") return null;
  if (progress.state !== "started" && progress.state !== "completed") return null;

  const fileNumber = normalizePositiveInteger(progress.fileNumber);
  const totalFiles = normalizePositiveInteger(progress.totalFiles);
  const fileName = getDisplayFileName(progress.fileName);
  if (!fileNumber || !totalFiles || fileNumber > totalFiles || !fileName) return null;

  return {
    state: progress.state,
    fileName,
    fileNumber,
    totalFiles,
    ok: progress.state === "completed" ? progress.ok === true : null,
  };
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.trunc(number);
}

function getDisplayFileName(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().split(/[\\/]/).pop() || null;
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
