/**
 * Browser DataSource backed by CSV files already loaded in memory.
 * It keeps current map behavior while giving the UI a backend-neutral API.
 */
import { deriveMapFeaturesFromFiles } from "./mapFeatureDerivation";

const DEFAULT_GROUP_ROWS_LIMIT = 30;

export function createInMemoryDataSource({ files }) {
  const datasets = Array.isArray(files) ? files : [];

  return {
    // Build the compact map data that Leaflet needs to render the current view.
    queryMapView(query = {}) {
      const derived = deriveMapFeaturesFromFiles({
        files: datasets,
        timeline: query.timeline ?? null,
      });

      return {
        points: derived.points.points.map(toDataSourceFeature),
        lines: derived.lines.lines.map(toDataSourceFeature),
        regions: derived.regions.polygons.map(toDataSourceFeature),
        stats: {
          skippedPoints: derived.points.skipped,
          skippedLines: derived.lines.skipped,
          skippedRegions: derived.regions.skipped,
          skippedPointsByTimeline: derived.points.skippedByTimeline,
          skippedLinesByTimeline: derived.lines.skippedByTimeline,
          skippedRegionsByTimeline: derived.regions.skippedByTimeline,
          skippedByTimeline:
            (derived.points.skippedByTimeline ?? 0) +
            (derived.lines.skippedByTimeline ?? 0) +
            (derived.regions.skippedByTimeline ?? 0),
          limitedToRenderBudget: null,
        },
        timelineIndex: derived.timelineIndex,
      };
    },

    // Return the original CSV row for a selected feature popup/detail view.
    getFeatureDetails(query = {}) {
      const sourceRef = query.sourceRef ?? null;
      const row = getSourceRow(datasets, sourceRef);
      const dataset = getDataset(datasets, sourceRef?.datasetId);

      return {
        featureId: query.featureId ?? null,
        row,
        latField: dataset?.latField ?? null,
        lonField: dataset?.lonField ?? null,
      };
    },

    // Return one page of source rows. Today this is dataset-based, not grouped markers.
    getGroupRows(query = {}) {
      const dataset = getDataset(datasets, query.datasetId ?? query.groupId);
      const rows = dataset?.rows ?? [];
      const offset = Math.max(0, Number.parseInt(query.offset ?? 0, 10) || 0);
      const limit = Math.max(
        0,
        Number.parseInt(query.limit ?? DEFAULT_GROUP_ROWS_LIMIT, 10) || 0,
      );

      return {
        rows: rows.slice(offset, offset + limit),
        offset,
        limit,
        totalRows: dataset?.totalRows ?? rows.length,
      };
    },

    // Return file-level metadata used by panels and future dataset-aware UI.
    getDatasetSummary() {
      return {
        datasets: datasets.map((file) => ({
          id: file.id,
          name: file.name,
          enabled: !!file.enabled,
          headers: file.headers ?? [],
          rowCount: file.rows?.length ?? 0,
          totalRows: file.totalRows ?? file.rows?.length ?? 0,
          latField: file.latField ?? null,
          lonField: file.lonField ?? null,
          parseErrors: file.parseErrors ?? [],
        })),
        timeline: getTimelineSummary(datasets),
      };
    },
  };
}

function toDataSourceFeature(feature) {
  // Keep legacy sourceFileId/sourceRowIndex while GeoMap still reads them.
  // Future UI cleanup can switch detail lookups to sourceRef directly.
  return {
    ...feature,
    sourceRef: getFeatureSourceRef(feature),
  };
}

function getFeatureSourceRef(feature) {
  if (!feature?.sourceFileId || feature.sourceRowIndex == null) {
    return null;
  }

  return {
    datasetId: feature.sourceFileId,
    rowIndex: feature.sourceRowIndex,
  };
}

function getSourceRow(files, sourceRef) {
  const dataset = getDataset(files, sourceRef?.datasetId);
  if (!dataset || sourceRef?.rowIndex == null) return null;

  return dataset.rows?.[sourceRef.rowIndex] ?? null;
}

function getDataset(files, datasetId) {
  if (!datasetId) return null;
  return files.find((file) => file.id === datasetId) ?? null;
}

function getTimelineSummary(files) {
  let yearMin = null;
  let yearMax = null;
  const timelineIndex = deriveMapFeaturesFromFiles({
    files,
    timeline: null,
  }).timelineIndex;

  for (const entry of timelineIndex.entries) {
    if (yearMin == null || entry.startYear < yearMin) yearMin = entry.startYear;
    if (yearMax == null || entry.endYear > yearMax) yearMax = entry.endYear;
  }

  if (yearMin == null || yearMax == null) return null;

  return { yearMin, yearMax };
}
