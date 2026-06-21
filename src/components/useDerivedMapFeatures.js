import { useMemo } from "react";
import { deriveLinesFromCsv } from "./deriveLines";
import { derivePointsFromCsv } from "./derivePoints";
import { deriveRegionsFromCsv } from "./deriveRegions";
import { detectFeatureTypeField } from "./featureTypes";
import { autoDetectRangeFields, autoDetectTimelineFields } from "./timeline";

export function useDerivedMapFeatures({ files, timeline }) {
  return useMemo(() => {
    const points = { items: [], skipped: 0, skippedByTimeline: 0 };
    const lines = { items: [], skipped: 0, skippedByTimeline: 0 };
    const regions = { items: [], skipped: 0, skippedByTimeline: 0 };

    // Merge derived map features from all enabled CSV files into one map-ready result.
    for (const file of files.filter((item) => item.enabled)) {
      const timelineFields = autoDetectTimelineFields(file.headers ?? []);
      const rangeFields = autoDetectRangeFields(file.headers ?? []);
      const featureTypeField = detectFeatureTypeField(file.headers ?? []);

      const commonArgs = {
        rows: file.rows,
        latField: file.latField,
        lonField: file.lonField,
        timeline,
        timelineFields,
        rangeFields,
        featureTypeField,
        idPrefix: file.id,
      };

      const pointResult = derivePointsFromCsv(commonArgs);
      points.items.push(
        ...pointResult.points.map((point) => ({
          ...point,
          latField: file.latField,
          lonField: file.lonField,
        })),
      );
      points.skipped += pointResult.skipped;
      points.skippedByTimeline += pointResult.skippedByTimeline;

      const lineResult = deriveLinesFromCsv(commonArgs);
      lines.items.push(
        ...lineResult.lines.map((line) => ({
          ...line,
          latField: file.latField,
          lonField: file.lonField,
        })),
      );
      lines.skipped += lineResult.skipped;
      lines.skippedByTimeline += lineResult.skippedByTimeline;

      const regionResult = deriveRegionsFromCsv(commonArgs);
      regions.items.push(
        ...regionResult.polygons.map((region) => ({
          ...region,
          latField: file.latField,
          lonField: file.lonField,
        })),
      );
      regions.skipped += regionResult.skipped;
      regions.skippedByTimeline += regionResult.skippedByTimeline;
    }

    return {
      points: {
        points: points.items,
        skipped: points.skipped,
        skippedByTimeline: points.skippedByTimeline,
      },
      lines: {
        lines: lines.items,
        skipped: lines.skipped,
        skippedByTimeline: lines.skippedByTimeline,
      },
      regions: {
        polygons: regions.items,
        skipped: regions.skipped,
        skippedByTimeline: regions.skippedByTimeline,
      },
    };
  }, [files, timeline]);
}
