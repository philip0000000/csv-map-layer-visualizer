import React, { useMemo, useRef } from "react";

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
}) {
  /**
   * Hidden file input reference.
   * We trigger this programmatically when user clicks "Import..."
   */
  const fileInputRef = useRef(null);

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

  return (
    <div className="csvPanel" role="region" aria-label="CSV files panel">
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


