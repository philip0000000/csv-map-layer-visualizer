import React, { useMemo } from "react";
import DualRangeSlider from "./DualRangeSlider";
import CsvPreviewTable from "./csv-panel/CsvPreviewTable";
import SelectedFileMetadata from "./csv-panel/SelectedFileMetadata";
import CoordinateMapping from "./csv-panel/CoordinateMapping";
import CsvParsingWarnings from "./csv-panel/CsvParsingWarnings";
import CsvFileControls from "./csv-panel/CsvFileControls";
import MapToolsMenu from "./csv-panel/MapToolsMenu";

/**
 * CsvPanel
 *
 * Left-side (overlay) panel that lets the user:
 * - Import one or more CSV files
 * - Select one CSV file for preview
 * - Enable or disable CSV files for map display
 * - Unload loaded CSV files
 * - Preview basic metadata and a few rows
 *
 * This component does NOT parse CSV files itself.
 * All parsing and storage is handled outside (useCsvFiles hook).
 */
export default function CsvPanel({
  files,            // Array of loaded CSV file objects
  selectedId,       // ID of the currently selected CSV file
  onSelect,         // Callback to change selected CSV
  onImportFiles,    // Callback to import new CSV files
  onUnloadFile,     // Callback to unload a CSV by ID
  onToggleEnabled,  // Callback to toggle file visibility
  onUpdateMapping,  // Callback when user changes latitude/longitude fields

  timelineState,
  timelineFields,
  onTimelinePatch,
  onTimelinePlaybackStart,
  onTimelinePlaybackStop,
  timelineStats,
  mapToolsState,
  onMapToolsPatch,
}) {

  /**
   * Find the currently selected CSV file object.
   * useMemo avoids recalculating unless files or selectedId changes.
   */
  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId]
  );

  // local editable inputs for "Year domain" (min/max + Begin)
  // These are UI-only text boxes so the user can type without instantly snapping/clamping.
  const yearMinDraft = timelineState?.yearMinDraft ?? "";
  const yearMaxDraft = timelineState?.yearMaxDraft ?? "";

  function beginYearDomain() {
    if (!onTimelinePatch) return;

    const min = toIntOrNull(yearMinDraft);
    const max = toIntOrNull(yearMaxDraft);

    if (min == null || max == null) return;

    const lo = Math.min(min, max);
    const hi = Math.max(min, max);

    // Update domain and clamp selection into it.
    const curStart = timelineState?.startYear;
    const curEnd = timelineState?.endYear;

    const nextStartRaw = curStart == null ? lo : clampInt(curStart, lo, hi);
    const nextEndRaw = curEnd == null ? hi : clampInt(curEnd, lo, hi);

    const nextStart = Math.min(nextStartRaw, nextEndRaw);
    const nextEnd = Math.max(nextStartRaw, nextEndRaw);

    patchTimelineWithStop({
      // lock the domain so auto-detection does not overwrite it
      yearDomainMode: "manual",

      yearMin: lo,
      yearMax: hi,
      yearMinDraft: String(lo),
      yearMaxDraft: String(hi),
      startYear: nextStart,
      endYear: nextEnd,
    });
  }

  const canBeginYearDomain =
    toIntOrNull(yearMinDraft) != null && toIntOrNull(yearMaxDraft) != null;


  function patchTimelineWithStop(partial) {
    // Stop first, so timer is cleared.
    onTimelinePlaybackStop?.();

    // If we patch playback settings, force isPlaying to false.
    // This avoids overwriting the stop patch with stale isPlaying=true.
    if (partial?.playback) {
      onTimelinePatch?.({
        ...partial,
        playback: {
          ...partial.playback,
          isPlaying: false,
        },
      });
      return;
    }

    onTimelinePatch?.(partial);
  }

  const playbackState = timelineState?.playback ?? {};
  const playbackIntervalSec = Number.isFinite(Number(playbackState.intervalMs))
    ? Number(playbackState.intervalMs) / 1000
    : 0;

  return (
    <div className="csvPanel" role="region" aria-label="CSV files panel">
      {/* =========================
          Tool menus (Map)
          - Side-by-side headers
          - Dropdown bodies overlay content below (no layout push)
          - State persisted in sessionStorage
        ========================= */}
      <MapToolsMenu
        timelineState={timelineState}
        onTimelinePatch={onTimelinePatch}
        mapToolsState={mapToolsState}
        onMapToolsPatch={onMapToolsPatch}
      />

      {/* =========================
          Panel header
         ========================= */}
      <div className="csvPanelHeader">
        <div className="csvPanelHeaderTop">
          <div className="csvPanelTitle">CSV Files</div>
        </div>

        {/* =========================
            File controls
           ========================= */}
        <div className="csvPanelControls">
          <CsvFileControls
            files={files}
            selectedId={selectedId}
            onSelect={onSelect}
            onImportFiles={onImportFiles}
            onUnloadFile={onUnloadFile}
            onToggleEnabled={onToggleEnabled}
          />

          {/* Timeline UI lives inside the panel header (NOT in the dropdown). */}
          {timelineState?.timelineEnabled && (
            <div className="csvTimelineBlock" aria-label="Timeline filter">
              <div className="csvTimelineTitleRow">
                <div className="csvTimelineTitle">Timeline filter</div>
              </div>

              {/* domain controls (Min/Max + Begin) */}
              <div className="csvTimelineDomainRow">
                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">Timeline start</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={yearMinDraft}
                    onChange={(e) => patchTimelineWithStop({ yearMinDraft: e.target.value })}
                  />
                </label>

                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">Timeline end</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={yearMaxDraft}
                    onChange={(e) => patchTimelineWithStop({ yearMaxDraft: e.target.value })}
                  />
                </label>

                <button
                  type="button"
                  className="csvBtnPrimary"
                  style={{ width: 110 }}
                  onClick={beginYearDomain}
                  disabled={!canBeginYearDomain}
                  aria-disabled={!canBeginYearDomain}
                >
                  Apply
                </button>
              </div>

              <div className="csvTimelineSubLabel">Visible year range</div>

              <DualRangeSlider
                min={timelineState?.yearMin ?? 0}
                max={timelineState?.yearMax ?? 0}
                step={1}
                start={timelineState?.startYear ?? timelineState?.yearMin ?? 0}
                end={timelineState?.endYear ?? timelineState?.yearMax ?? 0}
                disabled={timelineState?.yearMin == null || timelineState?.yearMax == null}
                onChange={({ start, end }) =>
                  patchTimelineWithStop({ startYear: start, endYear: end })
                }
              />

              <div className="csvTimelineReadoutRow">
                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">From</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={timelineState?.startYear ?? ""}
                    min={timelineState?.yearMin ?? undefined}
                    max={timelineState?.yearMax ?? undefined}
                    onChange={(e) => {
                      const v = toIntOrNull(e.target.value);
                      patchTimelineWithStop({ startYear: v });
                    }}
                  />
                </label>

                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">To</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={timelineState?.endYear ?? ""}
                    min={timelineState?.yearMin ?? undefined}
                    max={timelineState?.yearMax ?? undefined}
                    onChange={(e) => {
                      const v = toIntOrNull(e.target.value);
                      patchTimelineWithStop({ endYear: v });
                    }}
                  />
                </label>
              </div>

              <button
                type="button"
                className="csvTimelineExpander"
                aria-expanded={!!timelineState?.playbackOpen}
                onClick={() =>
                  onTimelinePatch?.({
                    playbackOpen: !timelineState?.playbackOpen,
                  })
                }
              >
                <span className="csvTimelineExpanderLeft">
                  <span className="csvTimelineExpanderChevron" aria-hidden="true">
                    {timelineState?.playbackOpen ? "▾" : "▸"}
                  </span>
                  <span>Playback</span>
                </span>
              </button>

              {timelineState?.playbackOpen && (
                <div className="csvTimelinePlayback">
                  <div className="csvTimelineReadoutRow">
                    <label className="csvTimelineField">
                      <span className="csvTimelineLabel">Step (years)</span>
                      <input
                        className="csvSelect"
                        type="number"
                        min={1}
                        step={1}
                        value={playbackState.stepYears ?? 1}
                        onChange={(e) => {
                          const v = Number.parseInt(String(e.target.value ?? ""), 10);
                          patchTimelineWithStop({
                            playback: {
                              ...playbackState,
                              stepYears: Number.isInteger(v) && v > 0 ? v : 0,
                            },
                          });
                        }}
                      />
                    </label>

                    <label className="csvTimelineField">
                      <span className="csvTimelineLabel">Interval (sec)</span>
                      <input
                        className="csvSelect"
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={playbackIntervalSec}
                        onChange={(e) => {
                          const sec = Number.parseFloat(String(e.target.value ?? ""));
                          patchTimelineWithStop({
                            playback: {
                              ...playbackState,
                              intervalMs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0,
                            },
                          });
                        }}
                      />
                    </label>
                  </div>

                  <label className="csvToolToggle" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={!!playbackState.moveStartWithEnd}
                      onChange={(e) =>
                        patchTimelineWithStop({
                          playback: {
                            ...playbackState,
                            moveStartWithEnd: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>Move start with end</span>
                  </label>

                  <button
                    type="button"
                    className="csvBtnPrimary"
                    style={{ marginTop: 8, width: 160 }}
                    onClick={() => {
                      if (playbackState.isPlaying) {
                        onTimelinePlaybackStop?.();
                        return;
                      }

                      onTimelinePlaybackStart?.();
                    }}
                  >
                    {playbackState.isPlaying ? "Stop" : "Play timeline"}
                  </button>
                </div>
              )}

              {/* inline expander row with the same chevron style as Map tools */}
              <button
                type="button"
                className="csvTimelineExpander"
                aria-expanded={!!timelineState?.moreFiltersOpen}
                onClick={() => {
                  const willOpen = !timelineState?.moreFiltersOpen;

                  if (willOpen) {
                    const hasRange =
                      Number.isFinite(timelineState?.startDay) &&
                      Number.isFinite(timelineState?.endDay);

                    patchTimelineWithStop({
                      moreFiltersOpen: true,
                      dayFilterEnabled: true,

                      // Only initialize if never set before
                      ...(hasRange
                        ? {}
                        : {
                            startDay: 1,
                            endDay: 365,
                          }),
                    });
                    return;
                  }

                  // Closing More filters:
                  // - disable day filter, but KEEP values so we can restore them later
                  patchTimelineWithStop({
                    moreFiltersOpen: false,
                    dayFilterEnabled: false,
                  });
                }}
              >
                <span className="csvTimelineExpanderLeft">
                  <span className="csvTimelineExpanderChevron" aria-hidden="true">
                    {timelineState?.moreFiltersOpen ? "▾" : "▸"}
                  </span>
                  <span>More filters</span>
                </span>
              </button>

              {timelineState?.moreFiltersOpen && (
                <div className="csvTimelineMoreFilters">
                  <div style={{ marginTop: 10 }}>
                  <div className="csvTimelineSubLabel">Day range (1–365)</div>

                  <DualRangeSlider
                    min={1}
                    max={365}
                    step={1}
                    start={timelineState?.startDay ?? 1}
                    end={timelineState?.endDay ?? 365}
                    onChange={({ start, end }) =>
                      patchTimelineWithStop({ startDay: start, endDay: end })
                    }
                  />

                  <div className="csvTimelineReadoutRow">
                    <label className="csvTimelineField">
                      <span className="csvTimelineLabel">Start</span>
                      <input
                        className="csvSelect"
                        type="number"
                        value={timelineState?.startDay ?? 1}
                        readOnly
                      />
                    </label>

                    <label className="csvTimelineField">
                      <span className="csvTimelineLabel">End</span>
                      <input
                        className="csvSelect"
                        type="number"
                        value={timelineState?.endDay ?? 365}
                        readOnly
                      />
                    </label>
                  </div>

                  <div className="csvToolMenuHint" style={{ marginTop: 10 }}>
                    Wrap-around supported: if Start &gt; End then it means
                    “day ≥ Start OR day ≤ End”.
                  </div>
                </div>

                  <div className="csvToolMenuHint" style={{ marginTop: 10 }}>
                    Detected fields:
                    <div style={{ marginTop: 6 }}>
                      <div>Year: {timelineFields?.yearField ?? "(none)"}</div>
                      <div>Date/time: {timelineFields?.dateField ?? "(none)"}</div>
                      <div>Day-of-year: {timelineFields?.dayOfYearField ?? "(none)"}</div>
                    </div>
                    {timelineStats?.skippedByTimeline ? (
                      <div style={{ marginTop: 8 }}>
                        Skipped by timeline: {timelineStats.skippedByTimeline}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* =========================
          Panel body
         ========================= */}
      <div className="csvPanelBody">
        {/* No CSV selected */}
        {!selected ? (
          <div className="csvEmptyState">
            Import one or more CSV files to preview data here.
          </div>
        ) : (
          <>
            {!selected.enabled && (
              <div className="csvPreviewHint">
                Selected file is not visible on the map
              </div>
            )}

            {/* CSV metadata */}
            <SelectedFileMetadata
              name={selected.name}
              size={selected.size}
              totalRows={selected.totalRows}
              columnCount={selected.headers.length}
            />

            {/* =========================
                Coordinate mapping
                =========================
                This section lets the user choose which CSV columns
                should be used as latitude and longitude.

                The choices are saved per file and used later
                to create map points.
            */}
            <CoordinateMapping
              fileId={selected.id}
              headers={selected.headers}
              latField={selected.latField}
              lonField={selected.lonField}
              onUpdateMapping={onUpdateMapping}
            />

            {/* CSV parsing warnings (non-fatal) */}
            <CsvParsingWarnings errors={selected.parseErrors} />

            {/* Preview table */}
            <CsvPreviewTable
              key={selected.id}
              headers={selected.headers}
              rows={selected.rows}
            />

          </>
        )}
      </div>
    </div>
  );
}

function toIntOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
