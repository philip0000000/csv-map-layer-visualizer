import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_GROUP_ROWS_LIMIT } from '../data/dataSource';
import { buildMarkerDetailFields } from './markerDetailFields';

export function PointMarkerDetails({
  point,
  latField,
  lonField,
  getSourceRow,
  getFeatureDetails,
  isActive,
}) {
  const requestVersionRef = useRef(0);
  const [detailState, setDetailState] = useState({
    status: 'idle',
    details: null,
  });
  const shouldLoadDetails =
    typeof getFeatureDetails === 'function' && !!point?.sourceRef;
  const synchronousRow = getFeatureDetailRow(point, getSourceRow);
  const row = shouldLoadDetails
    ? detailState.details?.row ?? null
    : synchronousRow;
  const resolvedLatField = detailState.details?.latField ?? latField;
  const resolvedLonField = detailState.details?.lonField ?? lonField;

  useEffect(() => {
    // Browser rows are synchronous; desktop sourceRef rows load on activation.
    if (!isActive || !shouldLoadDetails) {
      requestVersionRef.current += 1;
      return undefined;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    // Deferring the request lets the loading state follow the activation render.
    queueMicrotask(() => {
      if (requestVersionRef.current !== requestVersion) return;
      setDetailState({ status: 'loading', details: null });

      Promise.resolve(getFeatureDetails({
        featureId: point.id,
        sourceRef: point.sourceRef,
      })).then((details) => {
        if (requestVersionRef.current !== requestVersion) return;

        setDetailState({
          status: details?.row ? 'loaded' : 'empty',
          details: details?.row ? details : null,
        });
      }).catch(() => {
        if (requestVersionRef.current !== requestVersion) return;
        setDetailState({ status: 'error', details: null });
      });
    });

    return () => {
      if (requestVersionRef.current === requestVersion) {
        requestVersionRef.current += 1;
      }
    };
  }, [
    getFeatureDetails,
    isActive,
    point.id,
    point.sourceRef,
    shouldLoadDetails,
  ]);

  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Point</div>

      <div>
        <b>lat:</b> {point.lat}
      </div>
      <div>
        <b>lon:</b> {point.lon}
      </div>

      <hr style={{ opacity: 0.25 }} />

      {shouldLoadDetails && (
        detailState.status === 'idle' || detailState.status === 'loading'
      ) && (
        <div>Loading details...</div>
      )}
      {shouldLoadDetails && detailState.status === 'empty' && (
        <div>No details found.</div>
      )}
      {shouldLoadDetails && detailState.status === 'error' && (
        <div>Could not load details.</div>
      )}

      {(!shouldLoadDetails || detailState.status === 'loaded') &&
        buildMarkerDetailFields(
          row,
          resolvedLatField,
          resolvedLonField,
        ).map(([key, value]) => (
          <div key={key} style={{ marginBottom: 4 }}>
            <b>{key}:</b> {String(value ?? '')}
          </div>
        ))}
    </div>
  );
}

/**
 * Show every marker in an ordered proximity result while loading details on expansion.
 * The first item is the originally clicked marker and starts expanded.
 */
export function NearbyMarkerDetails({
  points,
  getSourceRow,
  getFeatureDetails,
}) {
  return (
    <div style={{ minWidth: 280 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Markers near this location
      </div>

      {points.map((point, index) => (
        <NearbyMarkerDetailsItem
          key={`${point.id}:${index}`}
          point={point}
          index={index}
          getSourceRow={getSourceRow}
          getFeatureDetails={getFeatureDetails}
        />
      ))}
    </div>
  );
}

/** Render one expandable nearby-marker item and load backend details only when open. */
function NearbyMarkerDetailsItem({
  point,
  index,
  getSourceRow,
  getFeatureDetails,
}) {
  const [isOpen, setIsOpen] = useState(index === 0);

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      style={{ marginBottom: 8 }}
    >
      <summary>
        Marker {index + 1}{index === 0 ? ' (selected)' : ''}
      </summary>
      <div style={{ padding: '6px 0 2px 12px' }}>
        <PointMarkerDetails
          point={point}
          latField={point.latField}
          lonField={point.lonField}
          getSourceRow={getSourceRow}
          getFeatureDetails={getFeatureDetails}
          isActive={isOpen}
        />
      </div>
    </details>
  );
}

export function GroupedMarkerDetails({ point, getGroupRows, isActive }) {
  const requestVersionRef = useRef(0);
  const [pagingState, setPagingState] = useState({
    status: 'idle',
    rows: [],
    totalRows: null,
    error: null,
  });
  const canLoadGroupRows =
    typeof getGroupRows === 'function' && !!point?.groupRef;

  const loadPage = useCallback((offset, replaceRows) => {
    if (!canLoadGroupRows) return;

    // groupRef keeps every page tied to the marker's original map query.
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setPagingState((previous) => ({
      ...previous,
      status: offset === 0 ? 'loading' : 'loading-more',
      rows: replaceRows ? [] : previous.rows,
      totalRows: replaceRows ? null : previous.totalRows,
      error: null,
    }));

    Promise.resolve(getGroupRows({
      groupRef: point.groupRef,
      offset,
      limit: DEFAULT_GROUP_ROWS_LIMIT,
    })).then((result) => {
      if (requestVersionRef.current !== requestVersion) return;

      const pageRows = Array.isArray(result?.rows) ? result.rows : [];
      setPagingState((previous) => {
        const rows = replaceRows
          ? pageRows
          : [...previous.rows, ...pageRows];

        return {
          status: 'loaded',
          rows,
          totalRows: result?.totalRows ?? rows.length,
          error: null,
        };
      });
    }).catch(() => {
      if (requestVersionRef.current !== requestVersion) return;

      setPagingState((previous) => ({
        ...previous,
        status: previous.rows.length > 0 ? 'loaded' : 'error',
        error: 'Could not load group rows.',
      }));
    });
  }, [canLoadGroupRows, getGroupRows, point.groupRef]);

  useEffect(() => {
    if (!isActive) {
      requestVersionRef.current += 1;
      return undefined;
    }

    // A newly selected group always starts again from its first page.
    const activationVersion = requestVersionRef.current + 1;
    requestVersionRef.current = activationVersion;
    queueMicrotask(() => {
      if (requestVersionRef.current !== activationVersion) return;
      loadPage(0, true);
    });

    return () => {
      requestVersionRef.current += 1;
    };
  }, [isActive, loadPage]);

  const handleShowMore = useCallback((event) => {
    event.stopPropagation();
    loadPage(pagingState.rows.length, false);
  }, [loadPage, pagingState.rows.length]);

  const canShowMore =
    canLoadGroupRows &&
    pagingState.totalRows != null &&
    pagingState.rows.length < pagingState.totalRows;
  const title = point.renderType === 'representative'
    ? 'Representative marker'
    : 'Grouped markers';

  return (
    <div style={{ minWidth: 280, maxWidth: 420 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div>
        <b>count:</b> {point.count ?? 1}
      </div>
      <div>
        <b>lat:</b> {point.lat}
      </div>
      <div>
        <b>lon:</b> {point.lon}
      </div>

      {canLoadGroupRows && (
        <div
          style={{
            borderTop: '1px solid rgba(0, 0, 0, 0.15)',
            marginTop: 8,
            paddingTop: 8,
          }}
        >
          {(pagingState.status === 'idle' ||
            pagingState.status === 'loading') && (
              <div>Loading rows...</div>
            )}
          {pagingState.status === 'error' && (
            <div>{pagingState.error}</div>
          )}
          {pagingState.status === 'loaded' && pagingState.rows.length === 0 && (
            <div>No represented rows found.</div>
          )}
          {pagingState.rows.length > 0 && (
            <>
              <div style={{ marginBottom: 6 }}>
                Loaded {pagingState.rows.length} of{' '}
                {pagingState.totalRows ?? pagingState.rows.length} rows
              </div>
              <div
                style={{
                  maxHeight: 260,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {pagingState.rows.map((row, index) => (
                  <details
                    key={[point.id, index].join(':')}
                    style={{ marginBottom: 6 }}
                  >
                    <summary>Row {index + 1}</summary>
                    <div style={{ padding: '4px 0 2px 10px' }}>
                      {buildMarkerDetailFields(row, null, null).map(
                        ([key, value]) => (
                          <div key={key} style={{ marginBottom: 3 }}>
                            <b>{key}:</b> {String(value ?? '')}
                          </div>
                        ),
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}
          {pagingState.rows.length > 0 && pagingState.error && (
            <div style={{ marginTop: 6 }}>{pagingState.error}</div>
          )}
          {canShowMore && (
            <button
              type='button'
              onClick={handleShowMore}
              disabled={pagingState.status === 'loading-more'}
              style={{ marginTop: 8 }}
            >
              {pagingState.status === 'loading-more'
                ? 'Loading...'
                : 'Show 30 more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getFeatureDetailRow(feature, getSourceRow) {
  return feature?.row ??
    getSourceRow?.(feature?.sourceFileId, feature?.sourceRowIndex) ??
    null;
}
