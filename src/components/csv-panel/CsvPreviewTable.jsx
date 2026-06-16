import { useMemo, useState } from "react";

const PREVIEW_ROWS_INCREMENT = 30;

export default function CsvPreviewTable({ headers, rows }) {
  const [previewRowLimit, setPreviewRowLimit] = useState(
    PREVIEW_ROWS_INCREMENT,
  );

  const previewRows = useMemo(
    () => (rows ?? []).slice(0, previewRowLimit),
    [rows, previewRowLimit],
  );

  const previewTotalRows = rows?.length ?? 0;
  const canShowMorePreviewRows = previewRows.length < previewTotalRows;

  return (
    <>
      <div className="csvPreviewTitle">Preview</div>

      {headers.length === 0 ? (
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
              onClick={() =>
                setPreviewRowLimit((limit) =>
                  Math.min(limit + PREVIEW_ROWS_INCREMENT, previewTotalRows),
                )
              }
            >
              Show 30 more
            </button>
          )}
        </>
      )}
    </>
  );
}
