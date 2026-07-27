import { useRef } from "react";

export default function CsvFileControls({
  files,
  selectedId,
  onSelect,
  onImportFiles,
  desktopImport,
  datasetListState,
  viewportQueryStats,
  onUnloadFile,
  removeActionLabel = "Unload",
  onToggleEnabled,
}) {
  /**
   * Hidden file input reference.
   * We trigger this programmatically when user clicks "Import..."
   */
  const fileInputRef = useRef(null);
  const isDesktopImporting = desktopImport?.status === "importing";
  const desktopSummary = desktopImport?.summary ?? null;
  const desktopProgress = desktopImport?.progress ?? null;
  const desktopImportResults = Array.isArray(desktopSummary?.results)
    ? desktopSummary.results
    : [];
  const hiddenByRenderBudget = normalizeCount(viewportQueryStats?.hiddenByRenderBudget);
  const browserImportAvailable = typeof onImportFiles === "function";
  const canSelect = typeof onSelect === "function";
  const canToggleEnabled = typeof onToggleEnabled === "function";
  const canRemove = typeof onUnloadFile === "function";

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


          {hiddenByRenderBudget > 0 && (
            <div className="csvDesktopImportStatus" role="status">
              {hiddenByRenderBudget.toLocaleString()} datapoints are not being displayed
            </div>
          )}
          {desktopImport.status === "error" && (
            <div className="csvDesktopImportStatus csvDesktopImportStatusError" role="alert">
              {desktopImport.error ?? "Import failed."}
            </div>
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
          <div className="csvDesktopImportStatus csvDesktopImportStatusError" role="alert">
            {datasetListState.error ?? "Could not load datasets."}
          </div>
        )}
        {datasetListState?.mutationError && (
          <div className="csvDesktopImportStatus csvDesktopImportStatusError" role="alert">
            {datasetListState.mutationError}
          </div>
        )}
        {datasetListState?.removalError && (
          <div className="csvDesktopImportStatus csvDesktopImportStatusError" role="alert">
            {datasetListState.removalError}
          </div>
        )}
        {datasetListState?.queryError && (
          <div className="csvDesktopImportStatus csvDesktopImportStatusError" role="alert">
            {datasetListState.queryError}
          </div>
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
    </>
  );
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
