import React, { useEffect, useMemo, useRef } from "react";
import { useSessionStorageState } from "./useSessionStorageState";
import DualRangeSlider from "./DualRangeSlider";

/**
 * CsvPanel
 *
 * Left-side (overlay) panel that lets the user:
 * - Import one or more CSV files
 * - Switch between loaded CSV files
 * - Unload the selected CSV
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
  onUnloadSelected, // Callback to unload the selected CSV
  onUpdateMapping,  // Callback when user changes latitude/longitude fields

  timelineState,
  timelineFields,
  onTimelinePatch,
  timelineStats,
  mapToolsState,
  onMapToolsPatch,
}) {

  // Persisted UI tool state for the CSV panel.
  // - open: whether each dropdown is expanded
  // - toggles: boolean feature flags (UI only for now; no feature logic yet)
  const TOOLS_KEY = "csv-map-layer-visualizer.tools.v1";

  // We only keep "showTimelineFilter" for now (as a placeholder toggle),
  // and Debug tools is intentionally empty (placeholder text only).
  const DEFAULT_TOOLS_STATE = {
    map: {
      open: false,
      toggles: {
        showTimelineFilter: false,
      },
    },
    debug: {
      open: false,
      toggles: {
        // Future toggles will go here later.
      },
    },
  };

  const [tools, setTools] = useSessionStorageState(TOOLS_KEY, DEFAULT_TOOLS_STATE);

  function setSectionOpen(section, isOpen) {
    setTools((prev) => {
      // Defensive: keep behavior stable even if state gets partially corrupted in storage
      const next = {
        ...prev,
        map: {
          ...(prev?.map ?? { open: false, toggles: {} }),
        },
        debug: {
          ...(prev?.debug ?? { open: false, toggles: {} }),
        },
      };

      // Apply requested open/close change
      next[section] = {
        ...next[section],
        open: isOpen,
      };

      // Usability: enforce "only one open at a time" when opening.
      // Closing a section should not automatically open the other.
      if (isOpen) {
        const other = section === "map" ? "debug" : "map";
        next[other] = {
          ...next[other],
          open: false,
        };
      }

      return next;
    });
  }

  /**
   * Close all tool dropdowns.
   * Kept as a helper so outside-click and Esc can share the same logic.
   */
  function closeAllToolMenus() {
    setTools((prev) => ({
      ...prev,
      map: { ...(prev?.map ?? { open: false, toggles: {} }), open: false },
      debug: { ...(prev?.debug ?? { open: false, toggles: {} }), open: false },
    }));
  }

  function setToggle(section, toggleKey, isOn) {
    setTools((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        toggles: {
          ...prev[section]?.toggles,
          [toggleKey]: isOn,
        },
      },
    }));
  }

  /**
   * Hidden file input reference.
   * We trigger this programmatically when user clicks "Import..."
   */
  const fileInputRef = useRef(null);

  /**
   * Ref for the tool menus container.
   * Used to detect clicks outside the menus (to auto-close dropdowns).
   */
  const toolMenusRef = useRef(null);

  /**
   * Find the currently selected CSV file object.
   * useMemo avoids recalculating unless files or selectedId changes.
   */
  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId]
  );

  /**
   * We can only unload if a file is actually selected.
   */
  const canUnload = !!selected;

  /**
   * Trigger the hidden file input.
   * This opens the system file picker.
   */
  function handleClickImport() {
    fileInputRef.current?.click();
  }

  /**
   * Handle files selected by the user.
   * - Convert FileList to a normal array
   * - Pass files to the parent logic
   * - Reset input so the same file can be selected again later
   */
  function handleFileChange(e) {
    const list = e.target.files;
    if (!list || list.length === 0) return;

    onImportFiles(Array.from(list));

    // Reset input value so same file can be imported again
    e.target.value = "";
  }

  /**
   * Auto-close open tool menus when:
   * - user clicks anywhere outside the tool menus (including the map)
   * - user presses Escape
   *
   * Using pointerdown + capture phase makes this robust with Leaflet,
   * which sometimes stops propagation on map interactions.
   */
  useEffect(() => {
    const anyOpen = !!tools?.map?.open || !!tools?.debug?.open;
    if (!anyOpen) return;

    function onPointerDownCapture(e) {
      const root = toolMenusRef.current;
      if (!root) return;

      // If the click is inside the tool menus area, do nothing.
      if (root.contains(e.target)) return;

      // Otherwise, close any open dropdowns.
      closeAllToolMenus();
    }

    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      closeAllToolMenus();
    }

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tools?.map?.open, tools?.debug?.open]); // only rebind when open state changes

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

    onTimelinePatch({
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

  return (
    <div className="csvPanel" role="region" aria-label="CSV files panel">
      {/* =========================
          Tool menus (Map / Debug)
          - Side-by-side headers
          - Dropdown bodies overlay content below (no layout push)
          - State persisted in sessionStorage
        ========================= */}
      <div
        className="csvToolMenus"
        aria-label="Tool menus"
        ref={toolMenusRef}
      >
        {/* Map tools */}
        <section className="csvToolMenu">
          <button
            type="button"
            className="csvToolMenuHeader"
            aria-expanded={!!tools?.map?.open}
            onClick={() => setSectionOpen("map", !tools?.map?.open)}
          >
            <span className="csvToolMenuTitle">Map tools</span>
            <span className="csvToolMenuChevron" aria-hidden="true">
              {tools?.map?.open ? "▾" : "▸"}
            </span>
          </button>

          {/* Dropdown overlays */}
          {tools?.map?.open && (
            <div className="csvToolMenuBody" role="menu" aria-label="Map tools menu">
              {/* Toggle timeline filter on/off */}
              <label
                className="csvToolToggle"
                role="menuitemcheckbox"
                aria-checked={!!timelineState?.timelineEnabled}
              >
                <input
                  type="checkbox"
                  checked={!!timelineState?.timelineEnabled}
                  onChange={(e) =>
                    onTimelinePatch?.({ timelineEnabled: e.target.checked })
                  }
                />
                <span>Timeline</span>
              </label>

              {/* Toggle marker clustering on/off */}
              <label
                className="csvToolToggle"
                role="menuitemcheckbox"
                aria-checked={!!mapToolsState?.clusterMarkersEnabled}
              >
                <input
                  type="checkbox"
                  checked={!!mapToolsState?.clusterMarkersEnabled}
                  onChange={(e) =>
                    onMapToolsPatch?.({ clusterMarkersEnabled: e.target.checked })
                  }
                />
                <span>Cluster markers</span>
              </label>

              {/* 
                Cluster radius settings:
                - Only shown when clustering is enabled
                - User can type a number
                - The value is applied only when the input loses focus (onBlur)
                - This avoids recalculating clusters while typing
              */}
              {mapToolsState?.clusterMarkersEnabled && (
                <div style={{ marginTop: 8 }}>
                  <div className="csvLabel">Cluster radius (pixels)</div>

                  <input
                    className="csvSelect"
                    type="number"
                    min={10}
                    max={300}
                    step={1}
                    // Draft value: can be edited freely without changing the map yet
                    value={mapToolsState?.clusterRadiusDraft ?? ""}
                    onChange={(e) =>
                      onMapToolsPatch?.({ clusterRadiusDraft: e.target.value })
                    }
                    onBlur={() => {
                      // When leaving the input:
                      // - Parse the number
                      // - Fix invalid values
                      // - Clamp to a safe range
                      // - Commit it as the real cluster radius
                      const raw = mapToolsState?.clusterRadiusDraft;

                      let n = Number.parseInt(String(raw ?? "").trim(), 10);
                      if (!Number.isFinite(n)) {
                        n = mapToolsState?.clusterRadius ?? 80;
                      }

                      // Clamp to a safe range
                      n = Math.max(10, Math.min(300, n));

                      // Commit value only on blur (leave box)
                      onMapToolsPatch?.({
                        clusterRadius: n,
                        clusterRadiusDraft: n,
                      });
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        {/* Debug tools (placeholder for future) */}
        <section className="csvToolMenu">
          <button
            type="button"
            className="csvToolMenuHeader"
            aria-expanded={!!tools?.debug?.open}
            onClick={() => setSectionOpen("debug", !tools?.debug?.open)}
          >
            <span className="csvToolMenuTitle">Debug tools</span>
            <span className="csvToolMenuChevron" aria-hidden="true">
              {tools?.debug?.open ? "▾" : "▸"}
            </span>
          </button>

          {/* Dropdown overlays */}
          {tools?.debug?.open && (
            <div className="csvToolMenuBody" role="menu" aria-label="Debug tools menu">
              <div className="csvToolMenuHint">
                No debug tools yet. This menu will hold developer options later.
              </div>
            </div>
          )}
        </section>
      </div>

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
          {/* CSV selection dropdown */}
          <div className="csvRow">
            <div className="csvLabel">Loaded file</div>

            <select
              className="csvSelect"
              value={selectedId || ""}
              onChange={(e) => onSelect(e.target.value || null)}
              disabled={files.length === 0}
              aria-label="Select loaded CSV file"
            >
              {files.length === 0 ? (
                <option value="">No files loaded</option>
              ) : (
                files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Import / Unload buttons */}
          <div className="csvButtonsRow">
            <button
              className="csvBtnPrimary"
              onClick={handleClickImport}
              aria-label="Import CSV files"
            >
              Import...
            </button>

            <button
              className="csvBtnDanger"
              onClick={onUnloadSelected}
              disabled={!canUnload}
              aria-disabled={!canUnload}
              aria-label="Unload selected CSV"
              title={canUnload ? "Unload selected CSV" : "No file selected"}
            >
              Unload
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </div>

          {/* Timeline UI lives inside the panel header (NOT in the dropdown). */}
          {timelineState?.timelineEnabled && (
            <div className="csvTimelineBlock" aria-label="Timeline filter">
              <div className="csvTimelineTitleRow">
                <div className="csvTimelineTitle">Timeline filter</div>
              </div>

              {/* domain controls (Min/Max + Begin) */}
              <div className="csvTimelineDomainRow">
                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">Min</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={yearMinDraft}
                    onChange={(e) => onTimelinePatch?.({ yearMinDraft: e.target.value })}
                  />
                </label>

                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">Max</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={yearMaxDraft}
                    onChange={(e) => onTimelinePatch?.({ yearMaxDraft: e.target.value })}
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
                  Begin
                </button>
              </div>

              <div className="csvTimelineSubLabel">Year range</div>

              <DualRangeSlider
                min={timelineState?.yearMin ?? 0}
                max={timelineState?.yearMax ?? 0}
                step={1}
                start={timelineState?.startYear ?? timelineState?.yearMin ?? 0}
                end={timelineState?.endYear ?? timelineState?.yearMax ?? 0}
                disabled={timelineState?.yearMin == null || timelineState?.yearMax == null}
                onChange={({ start, end }) =>
                  onTimelinePatch?.({ startYear: start, endYear: end })
                }
              />

              <div className="csvTimelineReadoutRow">
                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">Start</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={timelineState?.startYear ?? ""}
                    min={timelineState?.yearMin ?? undefined}
                    max={timelineState?.yearMax ?? undefined}
                    onChange={(e) => {
                      const v = toIntOrNull(e.target.value);
                      onTimelinePatch?.({ startYear: v });
                    }}
                  />
                </label>

                <label className="csvTimelineField">
                  <span className="csvTimelineLabel">End</span>
                  <input
                    className="csvSelect"
                    type="number"
                    value={timelineState?.endYear ?? ""}
                    min={timelineState?.yearMin ?? undefined}
                    max={timelineState?.yearMax ?? undefined}
                    onChange={(e) => {
                      const v = toIntOrNull(e.target.value);
                      onTimelinePatch?.({ endYear: v });
                    }}
                  />
                </label>
              </div>

              {/* inline expander row (arrow chevron like Map tools/Debug tools) */}
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

                    onTimelinePatch?.({
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
                  onTimelinePatch?.({
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
                      onTimelinePatch?.({ startDay: start, endDay: end })
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
            {/* CSV metadata */}
            <div className="csvMeta">
              <div>
                <span className="csvMetaLabel">Name:</span> {selected.name}
              </div>
              <div>
                <span className="csvMetaLabel">Size:</span>{" "}
                {formatBytes(selected.size)}
              </div>
              <div>
                <span className="csvMetaLabel">Rows:</span> {selected.totalRows}
              </div>
              <div>
                <span className="csvMetaLabel">Columns:</span>{" "}
                {selected.headers.length}
              </div>
            </div>

            {/* =========================
                Coordinate mapping
                =========================
                This section lets the user choose which CSV columns
                should be used as latitude and longitude.

                The choices are saved per file and used later
                to create map points.
            */}
            <div className="csvMeta" style={{ marginTop: 10 }}>
              {/* Latitude column selector */}
              <div>
                <span className="csvMetaLabel">
                  Latitude field:
                </span>

                {/* Dropdown with all CSV headers */}
                <select
                  className="csvSelect"

                  // Current selected latitude column (or empty)
                  value={selected.latField || ""}

                  // Update the selected file when user changes the value
                  onChange={(e) =>
                    onUpdateMapping?.(
                      selected.id,
                      { latField: e.target.value || null }
                    )
                  }

                  aria-label="Select latitude field"
                  style={{ marginTop: 6 }}
                >
                  {/* No column selected */}
                  <option value="">
                    (not set)
                  </option>

                  {/* One option for each CSV header */}
                  {selected.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Longitude column selector */}
              <div>
                <span className="csvMetaLabel">
                  Longitude field:
                </span>

                {/* Dropdown with all CSV headers */}
                <select
                  className="csvSelect"

                  // Current selected longitude column (or empty)
                  value={selected.lonField || ""}

                  // Update the selected file when user changes the value
                  onChange={(e) =>
                    onUpdateMapping?.(
                      selected.id,
                      { lonField: e.target.value || null }
                    )
                  }

                  aria-label="Select longitude field"
                  style={{ marginTop: 6 }}
                >
                  {/* No column selected */}
                  <option value="">
                    (not set)
                  </option>

                  {/* One option for each CSV header */}
                  {selected.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* CSV parsing warnings (non-fatal) */}
            {selected.parseErrors?.length > 0 && (
              <details className="csvErrors">
                <summary>
                  Parsing warnings ({selected.parseErrors.length})
                </summary>

                <ul>
                  {selected.parseErrors.slice(0, 15).map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>

                {selected.parseErrors.length > 15 && (
                  <div className="csvErrorsMore">
                    Showing first 15. More warnings exist.
                  </div>
                )}
              </details>
            )}

            {/* Preview table */}
            <div className="csvPreviewTitle">Preview</div>

            {selected.headers.length === 0 ? (
              <div className="csvEmptyPreview">No headers detected.</div>
            ) : selected.previewRows.length === 0 ? (
              <div className="csvEmptyPreview">No data rows detected.</div>
            ) : (
              <div className="csvTableWrap">
                <table className="csvTable">
                  <thead>
                    <tr>
                      {selected.headers.map((h) => (
                        <th key={h} title={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {selected.previewRows.map((row, i) => (
                      <tr key={i}>
                        {selected.headers.map((h) => (
                          <td key={h} title={String(row[h] ?? "")}>
                            {String(row[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Convert file size in bytes to a readable string.
 * Example: 15360 -> "15.0 KB"
 */
function formatBytes(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "-";

  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;

  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }

  return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
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


