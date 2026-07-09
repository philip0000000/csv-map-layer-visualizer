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

const LARGE_RAW_MARKER_WARNING_THRESHOLD = 3000;
const SQLITE_RENDER_BUDGET = 1000;

export default function App() {
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

  const csvFileDrop = useCsvFileDrop({
    onImportFiles: importFiles,
  });

  useExampleCsvFilesFromUrl({
    importExampleFile,
  });
  // Electron exposes this object in desktop mode only. Browser builds will not have it.
  const desktopApi = useMemo(() => globalThis.csvMapDesktop ?? null, []);
  const desktopImportAvailable =
    !!desktopApi?.isDesktop && typeof desktopApi.importCsvToSqlite === "function";
  const [desktopImportState, setDesktopImportState] = useState({
    status: "idle",
    summary: null,
    error: null,
  });
  const [mapViewport, setMapViewport] = useState(null);
  const [desktopMapViewState, setDesktopMapViewState] = useState({
    status: "idle",
    result: null,
    error: null,
  });
  const desktopSqliteMapAvailable =
    desktopImportAvailable && typeof desktopApi?.queryMapView === "function";
  const desktopSqliteMapActive =
    desktopSqliteMapAvailable && desktopImportState.status === "imported";
  const desktopSqliteDataSource = useMemo(
    () => createDesktopSqliteDataSource({ desktopApi }),
    [desktopApi],
  );

  /**
   * Start the desktop-only SQLite import flow.
   * The imported rows are stored in SQLite, but they are not rendered on the map yet.
   */
  const importCsvToSqlite = useCallback(async () => {
    if (!desktopImportAvailable) return;

    setDesktopImportState({ status: "importing", summary: null, error: null });

    try {
      const result = await desktopApi.importCsvToSqlite();

      if (result?.canceled) {
        setDesktopImportState({ status: "canceled", summary: null, error: null });
        return;
      }

      if (result?.ok) {
        setDesktopImportState({ status: "imported", summary: result, error: null });
        return;
      }

      setDesktopImportState({
        status: "error",
        summary: null,
        error: "Import failed.",
      });
    } catch (error) {
      setDesktopImportState({
        status: "error",
        summary: null,
        error: error?.message ? String(error.message) : "Import failed.",
      });
    }
  }, [desktopApi, desktopImportAvailable]);

  const desktopImport = useMemo(() => ({
    isAvailable: desktopImportAvailable,
    status: desktopImportState.status,
    summary: desktopImportState.summary,
    error: desktopImportState.error,
    onImport: importCsvToSqlite,
  }), [
    desktopImportAvailable,
    desktopImportState.error,
    desktopImportState.status,
    desktopImportState.summary,
    importCsvToSqlite,
  ]);

  useEffect(() => {
    if (!desktopSqliteMapActive || !mapViewport?.bounds) {
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
    desktopSqliteMapActive,
    mapViewport,
    timelineState,
  ]);

  const desktopMapFeatures = useMemo(
    () => toLegacyMapFeatures(desktopMapViewState.result),
    [desktopMapViewState.result],
  );
  const activeMapFeatures = desktopSqliteMapActive && desktopMapViewState.result
    ? desktopMapFeatures
    : derivedMapFeatures;
  const viewportQueryStats = desktopSqliteMapActive
    ? desktopMapViewState.result?.stats ?? null
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
      onDragEnter={csvFileDrop.handleDragEnter}
      onDragOver={csvFileDrop.handleDragOver}
      onDragLeave={csvFileDrop.handleDragLeave}
      onDrop={csvFileDrop.handleDrop}
    >
      {csvFileDrop.isDraggingFiles && (
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
        />

        <CsvPanelOverlay>
          <CsvPanel
            files={files}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onImportFiles={importFiles}
            desktopImport={desktopImport}
            viewportQueryStats={viewportQueryStats}
            onUnloadSelected={unloadSelected}
            onUnloadFile={unloadFile}
            onToggleEnabled={updateFileEnabled}
            onUpdateMapping={updateFileMapping}
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
