import { useMemo } from "react";
import { deriveLinesFromCsv } from "./deriveLines";
import { derivePointsFromCsv } from "./derivePoints";
import { deriveRegionsFromCsv } from "./deriveRegions";
import { detectFeatureTypeField } from "./featureTypes";
import { autoDetectRangeFields, autoDetectTimelineFields } from "./timeline";
import { buildTimelineIndex, getVisibleTimelineFeatureIds } from "./timelineIndex";

export function useDerivedMapFeatures({ files, timeline }) {
  return useMemo(() => {
    const points = { items: [], skipped: 0 };
    const lines = { items: [], skipped: 0 };
    const regions = { items: [], skipped: 0 };
    const timelineIndex = { entries: [] };
    const enabledFiles = files.filter((item) => item.enabled);
    const sourceRowsByFileId = new Map(
      enabledFiles.map((file) => [file.id, file.rows ?? []]),
    );

    const getSourceRow = (sourceFileId, sourceRowIndex) => (
      sourceRowsByFileId.get(sourceFileId)?.[sourceRowIndex] ?? null
    );

    // Merge derived map features from all enabled CSV files into one map-ready result.
    for (const file of enabledFiles) {
      const timelineFields = autoDetectTimelineFields(file.headers ?? []);
      const rangeFields = autoDetectRangeFields(file.headers ?? []);
      const featureTypeField = detectFeatureTypeField(file.headers ?? []);

      const commonArgs = {
        rows: file.rows,
        latField: file.latField,
        lonField: file.lonField,
        featureTypeField,
        idPrefix: file.id,
      };

      const pointResult = derivePointsFromCsv(commonArgs);
      const pointFeatures = pointResult.points.map((point) => ({
        ...point,
        sourceFileId: file.id,
        latField: file.latField,
        lonField: file.lonField,
      }));
      points.items.push(...pointFeatures);
      points.skipped += pointResult.skipped;

      const lineResult = deriveLinesFromCsv(commonArgs);
      const lineFeatures = lineResult.lines.map((line) => ({
        ...line,
        sourceFileId: file.id,
        latField: file.latField,
        lonField: file.lonField,
      }));
      lines.items.push(...lineFeatures);
      lines.skipped += lineResult.skipped;

      const regionResult = deriveRegionsFromCsv(commonArgs);
      const regionFeatures = regionResult.polygons.map((region) => ({
        ...region,
        sourceFileId: file.id,
        latField: file.latField,
        lonField: file.lonField,
      }));
      regions.items.push(...regionFeatures);
      regions.skipped += regionResult.skipped;

      timelineIndex.entries.push(
        ...buildTimelineIndex({
          features: [...pointFeatures, ...lineFeatures, ...regionFeatures],
          getSourceRow,
          timelineFields,
          rangeFields,
        }).entries,
      );
    }

    const visibleTimelineFeatureIds = timeline?.timelineEnabled
      ? getVisibleTimelineFeatureIds(timelineIndex, timeline)
      : null;
    const visiblePoints = filterByVisibleIds(points.items, visibleTimelineFeatureIds);
    const visibleLines = filterByVisibleIds(lines.items, visibleTimelineFeatureIds);
    const visibleRegions = filterByVisibleIds(regions.items, visibleTimelineFeatureIds);

    return {
      points: {
        points: visiblePoints,
        skipped: points.skipped,
        skippedByTimeline: points.items.length - visiblePoints.length,
      },
      lines: {
        lines: visibleLines,
        skipped: lines.skipped,
        skippedByTimeline: lines.items.length - visibleLines.length,
      },
      regions: {
        polygons: visibleRegions,
        skipped: regions.skipped,
        skippedByTimeline: regions.items.length - visibleRegions.length,
      },
      getSourceRow,
      timelineIndex,
    };
  }, [files, timeline]);
}

function filterByVisibleIds(features, visibleIds) {
  if (!visibleIds) return features;
  return features.filter((feature) => visibleIds.has(feature.id));
}
