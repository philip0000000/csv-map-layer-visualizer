/**
 * Current browser/in-memory map feature derivation shared by the DataSource adapter.
 */

import { deriveLinesFromCsv } from "../components/deriveLines";
import { derivePointsFromCsv } from "../components/derivePoints";
import { deriveRegionsFromCsv } from "../components/deriveRegions";
import { detectFeatureTypeField } from "../components/featureTypes";
import {
  autoDetectRangeFields,
  autoDetectTimelineFields,
} from "../components/timeline";
import {
  buildTimelineIndex,
  getVisibleTimelineFeatureIds,
} from "../components/timelineIndex";

export function deriveMapFeaturesFromFiles({ files, timeline }) {
  const points = { items: [], skipped: 0 };
  const lines = { items: [], skipped: 0 };
  const regions = { items: [], skipped: 0 };
  const timelineIndex = { entries: [] };
  // Only enabled files should create map features.
  const enabledFiles = (files ?? []).filter((item) => item.enabled);
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

    // Reuse the existing CSV-to-map helpers so behavior stays the same.
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

    // The timeline index stores feature ids and year ranges, not full rows.
    timelineIndex.entries.push(
      ...buildTimelineIndex({
        features: [...pointFeatures, ...lineFeatures, ...regionFeatures],
        getSourceRow,
        timelineFields,
        rangeFields,
      }).entries,
    );
  }

  // If timeline filtering is on, keep only features in the selected year range.
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
}

function filterByVisibleIds(features, visibleIds) {
  if (!visibleIds) return features;
  return features.filter((feature) => visibleIds.has(feature.id));
}
