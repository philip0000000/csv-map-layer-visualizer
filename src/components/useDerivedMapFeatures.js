import { useMemo } from 'react';

/**
 * Bridge hook for the current React UI.
 * Queries the selected DataSource while preserving the old return shape
 * expected by App and GeoMap.
 */
export function useDerivedMapFeatures({
  dataSource,
  dataRevision,
  enabled,
  timeline,
}) {
  return useMemo(() => {
    if (!enabled) return createEmptyLegacyMapFeatures();
    // The stable adapter mutates internally, so revision invalidates the query.
    void dataRevision;
    const mapView = dataSource.queryMapView({ timeline });

    const getSourceRow = (sourceFileId, sourceRowIndex) => (
      dataSource.getFeatureDetails({
        sourceRef: {
          datasetId: sourceFileId,
          rowIndex: sourceRowIndex,
        },
      }).row
    );

    return {
      points: {
        points: mapView.points,
        skipped: mapView.stats.skippedPoints,
        skippedByTimeline: mapView.stats.skippedPointsByTimeline,
      },
      lines: {
        lines: mapView.lines,
        skipped: mapView.stats.skippedLines,
        skippedByTimeline: mapView.stats.skippedLinesByTimeline,
      },
      regions: {
        polygons: mapView.regions,
        skipped: mapView.stats.skippedRegions,
        skippedByTimeline: mapView.stats.skippedRegionsByTimeline,
      },
      getSourceRow,
      timelineIndex: mapView.timelineIndex,
    };
  }, [dataRevision, dataSource, enabled, timeline]);
}

function createEmptyLegacyMapFeatures() {
  return {
    points: { points: [], skipped: 0, skippedByTimeline: 0 },
    lines: { lines: [], skipped: 0, skippedByTimeline: 0 },
    regions: { polygons: [], skipped: 0, skippedByTimeline: 0 },
    getSourceRow: () => null,
    timelineIndex: { entries: [] },
  };
}
