export default function SelectedFileMetadata({
  name,
  size,
  totalRows,
  columnCount,
}) {
  return (
    <div className="csvMeta">
      <div>
        <span className="csvMetaLabel">Name:</span> {name}
      </div>
      <div>
        <span className="csvMetaLabel">Size:</span> {formatBytes(size)}
      </div>
      <div>
        <span className="csvMetaLabel">Rows:</span> {totalRows}
      </div>
      <div>
        <span className="csvMetaLabel">Columns:</span> {columnCount}
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
