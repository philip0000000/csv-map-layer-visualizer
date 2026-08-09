import { useEffect, useReducer, useRef, useState } from "react";
import { DismissButton, DismissibleMessage } from "./DismissibleMessage";
import {
  INITIAL_CONDITION_DISMISSAL,
  reduceConditionDismissal,
} from "../messageDismissalState";

/** Render import controls, persistent operation messages, and the dataset list. */
export default function CsvFileControls({
  files,
  selectedId,
  onSelect,
  onImportFiles,
  desktopImport,
  datasetListState,
  viewportQueryStats,
  onUnloadFile,
  onSaveAsCsv,
  removeActionLabel = "Unload",
  onToggleEnabled,
  onUseRecommendedTimelineRange,
  messageDismissal,
}) {
  /**
   * Hidden file input reference.
   * We trigger this programmatically when user clicks "Import..."
   */
  const fileInputRef = useRef(null);
  const contextMenuRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const pendingHoverRef = useRef(null);
  const [hoverMessage, setHoverMessage] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const isDesktopImporting = desktopImport?.status === "importing";
  const desktopSummary = desktopImport?.summary ?? null;
  const desktopProgress = desktopImport?.progress ?? null;
  const desktopImportResults = Array.isArray(desktopSummary?.results)
    ? desktopSummary.results
    : [];
  const hiddenByRenderBudget = normalizeCount(viewportQueryStats?.hiddenByRenderBudget);
  const [renderWarningDismissal, dispatchRenderWarningDismissal] = useReducer(
    reduceConditionDismissal,
    INITIAL_CONDITION_DISMISSAL,
  );
  const browserImportAvailable = typeof onImportFiles === "function";
  const canSelect = typeof onSelect === "function";
  const canToggleEnabled = typeof onToggleEnabled === "function";
  const canRemove = typeof onUnloadFile === "function";
  const canSaveAsCsv = typeof onSaveAsCsv === "function";
  const hasTerminalImportMessage = !isDesktopImporting && (
    desktopImportResults.length > 0 ||
    desktopImport?.status === "canceled" ||
    desktopImport?.status === "error"
  );

  useEffect(() => {
    // A changing positive count belongs to the same warning cycle. Only zero resets it.
    dispatchRenderWarningDismissal({
      type: "sync",
      active: hiddenByRenderBudget > 0,
    });
  }, [hiddenByRenderBudget]);

  /** Close the dataset-row context menu on outside interaction or Escape. */
  useEffect(() => {
    if (!contextMenu) return undefined;

    function handlePointerDown(event) {
      if (contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setContextMenu(null);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => () => {
    globalThis.clearTimeout(hoverTimerRef.current);
  }, []);

  /** Start one delayed hover without restarting across row child elements. */
  function handleRowPointerEnter(event, file) {
    pendingHoverRef.current = {
      text: formatRecommendedTimelineMessage(file.recommendedTimelineRange),
      ...getFloatingPosition(event.clientX, event.clientY, 360, 32),
    };
    globalThis.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = globalThis.setTimeout(() => {
      setHoverMessage(pendingHoverRef.current);
      hoverTimerRef.current = null;
    }, 1000);
  }

  /** Keep the message near the pointer while preserving the same hover target. */
  function handleRowPointerMove(event) {
    const position = getFloatingPosition(event.clientX, event.clientY, 360, 32);
    if (pendingHoverRef.current) {
      pendingHoverRef.current = { ...pendingHoverRef.current, ...position };
    }
    setHoverMessage((current) => current
      ? { ...current, ...position }
      : null);
  }

  /** Cancel pending and visible hover UI when the pointer leaves the row. */
  function clearHoverMessage() {
    globalThis.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    pendingHoverRef.current = null;
    setHoverMessage(null);
  }

  /** Open the existing dataset menu with actions scoped to the right-clicked row. */
  function handleRowContextMenu(event, file) {
    const range = file.recommendedTimelineRange;
    if (!range && !canSaveAsCsv) return;

    event.preventDefault();
    clearHoverMessage();
    setContextMenu({
      datasetId: file.id,
      range,
      ...getFloatingPosition(event.clientX, event.clientY, 360, range ? 80 : 44),
    });
  }

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
  function handleFileChange(event) {
    const list = event.target.files;
    if (!list || list.length === 0) return;

    onImportFiles(Array.from(list));

    // Reset input value so same file can be imported again
    event.target.value = "";
  }

  return (
    <>
      {browserImportAvailable && (
        <button
          className="csvBtnPrimary csvImportButton"
          onClick={handleClickImport}
          aria-label="Import CSV files"
        >
          Import...
        </button>
      )}

      {/* Desktop uses the native picker; browser mode uses the hidden input above. */}
      {desktopImport?.isAvailable && (
        <div className="csvDesktopImportBlock">
          {desktopImport.usesNativePicker && (
            <button
              type="button"
              className="csvBtnPrimary csvDesktopImportButton"
              onClick={desktopImport.onImport}
              disabled={isDesktopImporting}
              aria-label="Import CSV files"
            >
              {isDesktopImporting ? "Importing..." : "Import..."}
            </button>
          )}

          {isDesktopImporting && desktopProgress && (
            <div className="csvDesktopImportStatus" role="status">
              Importing {desktopProgress.fileNumber} of {desktopProgress.totalFiles}: {desktopProgress.fileName}
            </div>
          )}

          {hasTerminalImportMessage && (
            <div className="csvDismissibleMessageGroup">
              <DismissButton
                label="Dismiss import message"
                onDismiss={messageDismissal?.import}
              />
              {desktopImportResults.length > 0 && (
                <div className="csvDesktopImportStatus" role="status">
                  {desktopImportResults.map((result, index) => (
                    <div
                      key={`${result.fileName}-${index}`}
                      className={result.ok ? undefined : "csvDesktopImportStatusError"}
                    >
                      <div className="csvDesktopImportTitle">{result.fileName}</div>
                      {result.ok ? (
                        <>
                          <div>
                            Imported {result.importedFeatureCount} of {result.rowCount} rows
                            {result.skippedRowCount
                              ? `, skipped ${result.skippedRowCount}`
                              : ""}.
                          </div>
                          <div>Fields: {formatFieldList(result.detectedFields)}</div>
                          {result.warnings?.length > 0 && (
                            <div>{result.warnings.length} parsing warning(s).</div>
                          )}
                        </>
                      ) : (
                        <div>{getImportErrorMessage(result.error)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {desktopImport.status === "canceled" && (
                <div className="csvDesktopImportStatus" role="status">
                  Import canceled.
                </div>
              )}

              {desktopImport.status === "error" && (
                <div className="csvDesktopImportStatus csvDesktopImportStatusError" role="alert">
                  {desktopImport.error ?? "Import failed."}
                </div>
              )}
            </div>
          )}

          {hiddenByRenderBudget > 0 && !renderWarningDismissal.dismissed && (
            <DismissibleMessage
              className="csvDesktopImportStatus"
              dismissLabel="Dismiss warning"
              onDismiss={() => dispatchRenderWarningDismissal({ type: "dismiss" })}
              role="status"
            >
              {hiddenByRenderBudget.toLocaleString()} datapoints are not being displayed
            </DismissibleMessage>
          )}
        </div>
      )}

      {/* Hidden file input */}
      {browserImportAvailable && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      )}

      <div className="csvFilesList" role="list">
        <div className="csvFilesHeaderRow">
          <div>Show</div>
          <div>File</div>
          <div>Rows</div>
          <div />
        </div>

        {datasetListState?.status === "error" && (
          <DismissibleMessage
            className="csvDesktopImportStatus csvDesktopImportStatusError"
            dismissLabel="Dismiss dataset loading error"
            onDismiss={messageDismissal?.datasetLoad}
            role="alert"
          >
            {datasetListState.error ?? "Could not load datasets."}
          </DismissibleMessage>
        )}
        {datasetListState?.mutationError && (
          <DismissibleMessage
            className="csvDesktopImportStatus csvDesktopImportStatusError"
            dismissLabel="Dismiss dataset mutation error"
            onDismiss={messageDismissal?.datasetMutation}
            role="alert"
          >
            {datasetListState.mutationError}
          </DismissibleMessage>
        )}
        {datasetListState?.removalError && (
          <DismissibleMessage
            className="csvDesktopImportStatus csvDesktopImportStatusError"
            dismissLabel="Dismiss dataset removal error"
            onDismiss={messageDismissal?.datasetRemoval}
            role="alert"
          >
            {datasetListState.removalError}
          </DismissibleMessage>
        )}
        {datasetListState?.exportError && (
          <DismissibleMessage
            className="csvDesktopImportStatus csvDesktopImportStatusError"
            dismissLabel="Dismiss CSV save error"
            onDismiss={messageDismissal?.datasetExport}
            role="alert"
          >
            {datasetListState.exportError}
          </DismissibleMessage>
        )}
        {datasetListState?.queryError && (
          <DismissibleMessage
            className="csvDesktopImportStatus csvDesktopImportStatusError"
            dismissLabel="Dismiss dataset query error"
            onDismiss={messageDismissal?.datasetQuery}
            role="alert"
          >
            {datasetListState.queryError}
          </DismissibleMessage>
        )}

        {datasetListState?.status === "loading" && files.length === 0 ? (
          <div className="csvEmptyState">Loading CSV files...</div>
        ) : files.length === 0 ? (
          <div className="csvEmptyState">No CSV files loaded.</div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              role="listitem"
              className={`csvFilesRow${
                file.id === selectedId ? " csvFilesRowSelected" : ""
              }`}
              onClick={canSelect ? () => onSelect(file.id) : undefined}
              onPointerEnter={(event) => handleRowPointerEnter(event, file)}
              onPointerMove={handleRowPointerMove}
              onPointerLeave={clearHoverMessage}
              onContextMenu={(event) => handleRowContextMenu(event, file)}
            >
              <input
                type="checkbox"
                aria-label={`Toggle visibility for ${file.name}`}
                checked={!!file.enabled}
                disabled={
                  !canToggleEnabled ||
                  datasetListState?.pendingDatasetIds?.includes(file.id) ||
                  datasetListState?.pendingRemovalDatasetIds?.includes(file.id)
                }
                onChange={(e) => onToggleEnabled?.(file.id, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="csvFileNameButton"
                aria-disabled={!canSelect}
                onClick={() => onSelect?.(file.id)}
              >
                {file.name}
              </button>
              <div className="csvFileRows">{getDisplayedRowCount(file)}</div>
              {canRemove ? (
                <button
                  type="button"
                  className="csvBtnTiny"
                  disabled={
                    datasetListState?.pendingRemovalDatasetIds?.includes(file.id) ||
                    datasetListState?.pendingDatasetIds?.includes(file.id)
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnloadFile(file.id);
                  }}
                >
                  {removeActionLabel}
                </button>
              ) : <div />}
            </div>
          ))
        )}
      </div>

      {hoverMessage && (
        <div
          className="csvTimelineHoverMessage"
          style={{ left: hoverMessage.left, top: hoverMessage.top }}
          role="tooltip"
        >
          {hoverMessage.text}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="csvTimelineContextMenu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          role="menu"
          aria-label="CSV dataset actions"
        >
          {contextMenu.range && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // Apply all four values together so the slider never sees a mixed range.
                onUseRecommendedTimelineRange?.(contextMenu.range);
                setContextMenu(null);
              }}
            >
              Use recommended timeline range: {formatTimelineRange(contextMenu.range)}
            </button>
          )}
          {canSaveAsCsv && (
            <button
              type="button"
              role="menuitem"
              disabled={datasetListState?.pendingExportDatasetIds?.includes(
                contextMenu.datasetId,
              )}
              onClick={() => {
                // Capture the row identity before closing so selection never redirects export.
                onSaveAsCsv(contextMenu.datasetId);
                setContextMenu(null);
              }}
            >
              Save as CSV…
            </button>
          )}
        </div>
      )}
    </>
  );
}

function formatRecommendedTimelineMessage(range) {
  return range
    ? `Recommended timeline range: ${formatTimelineRange(range)}`
    : "No timeline available";
}

function formatTimelineRange(range) {
  return `${range.startYear}–${range.endYear}`;
}

/** Keep pointer-anchored UI inside the visible viewport. */
function getFloatingPosition(clientX, clientY, width, height) {
  const viewportWidth = globalThis.innerWidth ?? width;
  const viewportHeight = globalThis.innerHeight ?? height;
  return {
    left: Math.max(8, Math.min(clientX + 12, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(clientY + 12, viewportHeight - height - 8)),
  };
}

/**
 * Show the detected import fields in one short status line.
 */
function formatFieldList(fields) {
  if (!fields) return "none";

  return [
    fields.latField,
    fields.lonField,
    fields.yearField,
    fields.dateField,
  ]
    .filter(Boolean)
    .join(" / ") || "none";
}

function normalizeCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function getImportErrorMessage(error) {
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return "Import failed.";
}

function getDisplayedRowCount(file) {
  if (file?.importedFeatureCount != null) {
    return normalizeCount(file.importedFeatureCount);
  }

  return normalizeCount(file?.rows?.length ?? file?.rowCount);
}
