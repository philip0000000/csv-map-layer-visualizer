import { useMemo } from "react";
import { createInMemoryDataSource } from "../data/inMemoryDataSource";

/**
 * Bridge hook for the current React UI.
 * Internally queries the in-memory DataSource, but preserves the old return
 * shape expected by App/GeoMap until those components are migrated.
 */
export function useDerivedMapFeatures({ files, timeline }) {
  return useMemo(() => {
    const dataSource = createInMemoryDataSource({ files });
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
  }, [files, timeline]);
}
