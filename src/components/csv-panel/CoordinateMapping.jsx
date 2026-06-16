export default function CoordinateMapping({
  fileId,
  headers,
  latField,
  lonField,
  onUpdateMapping,
}) {
  return (
    <div className="csvMeta" style={{ marginTop: 10 }}>
      {/* Latitude column selector */}
      <div>
        <span className="csvMetaLabel">Latitude field:</span>

        {/* Dropdown with all CSV headers */}
        <select
          className="csvSelect"
          // Current selected latitude column (or empty)
          value={latField || ""}
          // Update the selected file when user changes the value
          onChange={(e) =>
            onUpdateMapping?.(fileId, { latField: e.target.value || null })
          }
          aria-label="Select latitude field"
          style={{ marginTop: 6 }}
        >
          {/* No column selected */}
          <option value="">(not set)</option>

          {/* One option for each CSV header */}
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      {/* Longitude column selector */}
      <div>
        <span className="csvMetaLabel">Longitude field:</span>

        {/* Dropdown with all CSV headers */}
        <select
          className="csvSelect"
          // Current selected longitude column (or empty)
          value={lonField || ""}
          // Update the selected file when user changes the value
          onChange={(e) =>
            onUpdateMapping?.(fileId, { lonField: e.target.value || null })
          }
          aria-label="Select longitude field"
          style={{ marginTop: 6 }}
        >
          {/* No column selected */}
          <option value="">(not set)</option>

          {/* One option for each CSV header */}
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
