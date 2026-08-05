import { useMemo, useState } from "react";
import { DismissibleMessage } from "./DismissibleMessage";

const PREVIEW_ROWS_INCREMENT = 30;

/** Render bounded CSV preview rows and any completed preview-loading error. */
export default function CsvPreviewTable({
  headers,
  rows,
  totalRows,
  hasMore,
  status = "loaded",
  error,
  onShowMore,
  onDismissError,
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
  // A dismissed initial-load error must not be replaced with a misleading empty-data message.
  const previewErrorDismissed = status === "error" && !error;

  return (
    <>
      <div className="csvPreviewTitle">Preview</div>

      {error && (
        <DismissibleMessage
          className="csvEmptyPreview"
          dismissLabel="Dismiss dataset loading error"
          onDismiss={onDismissError}
          role="alert"
        >
          {error}
        </DismissibleMessage>
      )}

      {status === "loading" ? (
        <div className="csvEmptyPreview">Loading preview rows...</div>
      ) : previewErrorDismissed || (error && previewTotalRows === 0) ? null : headers.length === 0 ? (
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
