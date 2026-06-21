import React, { useEffect, useMemo } from "react";
import "./App.css";
import GeoMap from "./components/GeoMap";
import CsvPanel from "./components/CsvPanel";
import { useCsvFiles } from "./components/useCsvFiles";
import { useTimelineFilterState } from "./components/useTimelineFilterState";
import {
  autoDetectRangeFields,
  autoDetectTimelineFields,
  parseDateValue,
  parseYearValue,
  tryGetYear,
} from "./components/timeline";
import { useMapToolsState } from "./components/useMapToolsState";
import { useDerivedMapFeatures } from "./components/useDerivedMapFeatures";
import { CsvPanelOverlay } from "./components/CsvPanelOverlay";
import { useCsvFileDrop } from "./components/useCsvFileDrop";
import { useExampleCsvFilesFromUrl } from "./components/useExampleCsvFilesFromUrl";
import { useTimelinePlayback } from "./components/useTimelinePlayback";

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

  const timelineApi = useTimelineFilterState();
  const mapToolsApi = useMapToolsState();
  const timelinePlaybackApi = useTimelinePlayback({
    timelineState: timelineApi.state,
    onTimelinePatch: timelineApi.patch,
  });

  const derivedMapFeatures = useDerivedMapFeatures({
    files,
    timeline: timelineApi.state,
  });

  const csvFileDrop = useCsvFileDrop({
    onImportFiles: importFiles,
  });

  useExampleCsvFilesFromUrl({
    importExampleFile,
  });

  const selectedHeaders = selected?.headers;

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
    if (!selected) return;
    if (!timelineApi.state.timelineEnabled) return;

    // if user has set a manual year domain, do not overwrite it from data
    if (timelineApi.state.yearDomainMode === "manual") return;

    let min = null;
    let max = null;

    for (const r of selected.rows ?? []) {
      const extent = getRowTimelineExtent(
        r,
        timelineFields,
        timelineRangeFields,
      );
      if (!extent) continue;

      if (min == null || extent.min < min) min = extent.min;
      if (max == null || extent.max > max) max = extent.max;
    }

    timelineApi.patch({
      yearMin: min,
      yearMax: max,
      // Keep the Min/Max input boxes in sync while in auto mode
      yearMinDraft: String(min ?? ""),
      yearMaxDraft: String(max ?? ""),
    });

    const s = timelineApi.state.startYear;
    const e = timelineApi.state.endYear;

    if (min != null && max != null) {
      const nextStart = s == null ? min : Math.max(min, Math.min(max, s));
      const nextEnd = e == null ? max : Math.max(min, Math.min(max, e));

      const finalStart = Math.min(nextStart, nextEnd);
      const finalEnd = Math.max(nextStart, nextEnd);

      if (finalStart !== s || finalEnd !== e) {
        timelineApi.setYearRange(finalStart, finalEnd);
      }
    }
  }, [
    selected?.id,
    timelineApi.state.timelineEnabled,
    timelineApi.state.yearDomainMode,
    selected?.rows,
    timelineFields,
    timelineRangeFields,
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
          points={derivedMapFeatures.points.points}
          regions={derivedMapFeatures.regions.polygons}
          lines={derivedMapFeatures.lines.lines}
          clusterMarkersEnabled={!!mapToolsApi.state.clusterMarkersEnabled}
          clusterRadius={mapToolsApi.state.clusterRadius}
        />

        <CsvPanelOverlay>
          <CsvPanel
            files={files}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onImportFiles={importFiles}
            onUnloadSelected={unloadSelected}
            onUnloadFile={unloadFile}
            onToggleEnabled={updateFileEnabled}
            onUpdateMapping={updateFileMapping}
            timelineState={timelineApi.state}
            timelineFields={timelineFields}
            onTimelinePatch={timelineApi.patch}
            onTimelinePlaybackStart={timelinePlaybackApi.startPlayback}
            onTimelinePlaybackStop={timelinePlaybackApi.stopPlayback}
            timelineStats={{
              skippedByTimeline:
                (derivedMapFeatures.points.skippedByTimeline ?? 0) +
                (derivedMapFeatures.regions.skippedByTimeline ?? 0) +
                (derivedMapFeatures.lines.skippedByTimeline ?? 0),
            }}
            mapToolsState={mapToolsApi.state}
            onMapToolsPatch={mapToolsApi.patch}
          />
        </CsvPanelOverlay>
      </div>
    </div>
  );
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

/**
 * Extract a year value from either a numeric year field or a date field.
 * Returns null when no usable value is present.
 */
function getRangeYear(row, yearField, dateField) {
  if (!row || typeof row !== "object") return null;

  if (yearField) {
    const y = parseYearValue(row[yearField]);
    if (y != null) return y;
  }

  if (dateField) {
    const d = parseDateValue(row[dateField]);
    if (d) return d.getUTCFullYear();
  }

  return null;
}
