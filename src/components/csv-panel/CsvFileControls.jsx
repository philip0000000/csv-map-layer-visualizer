import { useRef } from "react";

export default function CsvFileControls({
  files,
  selectedId,
  onSelect,
  onImportFiles,
  onUnloadFile,
  onToggleEnabled,
}) {
  /**
   * Hidden file input reference.
   * We trigger this programmatically when user clicks "Import..."
   */
  const fileInputRef = useRef(null);

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
      <button
        className="csvBtnPrimary csvImportButton"
        onClick={handleClickImport}
        aria-label="Import CSV files"
      >
        Import...
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

      <div className="csvFilesList" role="list">
        <div className="csvFilesHeaderRow">
          <div>Show</div>
          <div>File</div>
          <div>Rows</div>
          <div />
        </div>

        {files.length === 0 ? (
          <div className="csvEmptyState">No CSV files loaded.</div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              role="listitem"
              className={`csvFilesRow${
                file.id === selectedId ? " csvFilesRowSelected" : ""
              }`}
              onClick={() => onSelect(file.id)}
            >
              <input
                type="checkbox"
                aria-label={`Toggle visibility for ${file.name}`}
                checked={!!file.enabled}
                onChange={(e) => onToggleEnabled?.(file.id, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="csvFileNameButton"
                onClick={() => onSelect(file.id)}
              >
                {file.name}
              </button>
              <div className="csvFileRows">{file.rows?.length ?? 0}</div>
              <button
                type="button"
                className="csvBtnTiny"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnloadFile?.(file.id);
                }}
              >
                Unload
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
