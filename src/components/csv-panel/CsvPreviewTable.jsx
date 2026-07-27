import { useMemo, useState } from "react";

const PREVIEW_ROWS_INCREMENT = 30;

export default function CsvPreviewTable({
  headers,
  rows,
  totalRows,
  hasMore,
  status = "loaded",
  error,
  onShowMore,
}) {
  const controlledPaging = typeof onShowMore === "function";
  const [previewRowLimit, setPreviewRowLimit] = useState(
    PREVIEW_ROWS_INCREMENT,
  );

  const previewRows = useMemo(
    () => controlledPaging
      ? rows ?? []
      : (rows ?? []).slice(0, previewRowLimit),
    [controlledPaging, rows, previewRowLimit],
  );

  const previewTotalRows = controlledPaging
    ? totalRows ?? rows?.length ?? 0
    : rows?.length ?? 0;
  const canShowMorePreviewRows = controlledPaging
    ? !!hasMore
    : previewRows.length < previewTotalRows;

  return (
    <>
      <div className="csvPreviewTitle">Preview</div>

      {error && <div className="csvEmptyPreview" role="alert">{error}</div>}

      {status === "loading" ? (
        <div className="csvEmptyPreview">Loading preview rows...</div>
      ) : error && previewTotalRows === 0 ? null : headers.length === 0 ? (
        <div className="csvEmptyPreview">No headers detected.</div>
      ) : previewTotalRows === 0 ? (
        <div className="csvEmptyPreview">No data rows detected.</div>
      ) : (
        <>
          <div className="csvTableWrap">
            <table className="csvTable">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} title={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h} title={String(row[h] ?? "")}>
                        {String(row[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canShowMorePreviewRows && (
            <button
              type="button"
              className="csvBtnPrimary csvPreviewMoreButton"
              disabled={status === "loading-more"}
              onClick={controlledPaging
                ? onShowMore
                : () => setPreviewRowLimit((limit) => (
                    Math.min(limit + PREVIEW_ROWS_INCREMENT, previewTotalRows)
                  ))}
            >
              {status === "loading-more" ? "Loading..." : "Show 30 more"}
            </button>
          )}
        </>
      )}
    </>
  );
}
