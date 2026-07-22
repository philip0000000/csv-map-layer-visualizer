import { DEFAULT_GROUP_ROWS_LIMIT } from './dataSource.js';

const DEFAULT_SQLITE_RENDER_BUDGET = 1000;

/**
 * Renderer-side DataSource adapter for the Electron SQLite bridge.
 * It keeps IPC details out of React components and preserves the app-facing contract.
 */
export function createDesktopSqliteDataSource({ desktopApi }) {
  return {
    async queryMapView(query = {}) {
      if (typeof desktopApi?.queryMapView !== "function") {
        return createEmptyMapViewResult();
      }

      const result = await desktopApi.queryMapView({
        bounds: query.bounds ?? null,
        zoom: query.zoom ?? null,
        timeline: query.timeline ?? null,
        renderBudget: query.renderBudget ?? DEFAULT_SQLITE_RENDER_BUDGET,
      });

      return normalizeMapViewResult(result);
    },

    async getFeatureDetails(query = {}) {
      const sourceRef = normalizeFeatureSourceRef(query.sourceRef);
      if (
        typeof desktopApi?.getFeatureDetails !== 'function' ||
        !sourceRef
      ) {
        return createEmptyFeatureDetailsResult();
      }

      const result = await desktopApi.getFeatureDetails({ sourceRef });
      return normalizeFeatureDetailsResult(result);
    },

    async getGroupRows(query = {}) {
      const offset = normalizeNonNegativeInteger(query.offset, 0);
      const limit = normalizePositiveInteger(
        query.limit ?? DEFAULT_GROUP_ROWS_LIMIT,
        DEFAULT_GROUP_ROWS_LIMIT,
      );
      const groupRef = normalizeGroupRef(query.groupRef);

      if (typeof desktopApi?.getGroupRows !== 'function' || !groupRef) {
        return createEmptyGroupRowsResult(offset, limit);
      }

      const result = await desktopApi.getGroupRows({
        groupRef,
        offset,
        limit,
      });

      return normalizeGroupRowsResult(result, offset, limit);
    },

    async getDatasetSummary() {
      if (typeof desktopApi?.getDatasetSummary !== "function") {
        return createEmptyDatasetSummary();
      }

      const result = await desktopApi.getDatasetSummary();
      return normalizeDatasetSummary(result);
    },

    async setDatasetEnabled(datasetId, enabled) {
      const normalizedDatasetId = normalizeDatasetId(datasetId);
      if (
        typeof desktopApi?.setDatasetEnabled !== "function" ||
        !normalizedDatasetId ||
        typeof enabled !== "boolean"
      ) {
        return createDatasetMutationResult(false);
      }

      const result = await desktopApi.setDatasetEnabled(
        normalizedDatasetId,
        enabled,
      );
      return normalizeDatasetMutationResult(result);
    },

    async removeDataset(datasetId) {
      const normalizedDatasetId = normalizeDatasetId(datasetId);
      if (
        typeof desktopApi?.removeDataset !== "function" ||
        !normalizedDatasetId
      ) {
        return createDatasetRemovalResult(false);
      }

      const result = await desktopApi.removeDataset(normalizedDatasetId);
      return normalizeDatasetRemovalResult(result);
    },
  };
}

function normalizeDatasetSummary(result) {
  if (!result || typeof result !== "object") {
    return createEmptyDatasetSummary();
  }

  const datasets = Array.isArray(result.datasets)
    ? result.datasets.map(normalizeDatasetSummaryItem).filter(Boolean)
    : [];

  return {
    datasets,
    timeline: normalizeTimelineSummary(result.timeline),
  };
}

function normalizeDatasetSummaryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;

  const id = normalizeNullableString(item.id);
  const name = normalizeNullableString(item.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    enabled: item.enabled === true,
    headers: normalizeStringArray(item.headers),
    rowCount: normalizeNonNegativeInteger(item.rowCount, 0),
    totalRows: normalizeNonNegativeInteger(item.totalRows, 0),
    importedFeatureCount: normalizeNonNegativeInteger(
      item.importedFeatureCount,
      0,
    ),
    skippedRowCount: normalizeNonNegativeInteger(item.skippedRowCount, 0),
    importedAt: normalizeNullableString(item.importedAt),
    latField: normalizeNullableString(item.latField),
    lonField: normalizeNullableString(item.lonField),
    parseErrors: normalizeStringArray(item.parseErrors),
  };
}

function normalizeTimelineSummary(timeline) {
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) {
    return null;
  }

  const yearMin = normalizeOptionalInteger(timeline.yearMin);
  const yearMax = normalizeOptionalInteger(timeline.yearMax);
  if (yearMin == null || yearMax == null) return null;

  return { yearMin, yearMax };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

function normalizeDatasetMutationResult(result) {
  return createDatasetMutationResult(result?.updated === true);
}

function normalizeDatasetRemovalResult(result) {
  return createDatasetRemovalResult(result?.removed === true);
}

function normalizeDatasetId(value) {
  const datasetId = normalizeNullableString(value);
  return datasetId?.trim() || null;
}

function normalizeMapViewResult(result) {
  if (!result || typeof result !== "object") {
    return createEmptyMapViewResult();
  }

  const points = Array.isArray(result.points)
    ? result.points.map(normalizePointFeature)
    : [];
  const lines = Array.isArray(result.lines) ? result.lines : [];
  const regions = Array.isArray(result.regions) ? result.regions : [];
  const stats = normalizeStats(result.stats, points.length);
  const timelineIndex = result.timelineIndex && typeof result.timelineIndex === "object"
    ? result.timelineIndex
    : { entries: [] };

  return {
    points,
    lines,
    regions,
    stats,
    timelineIndex: {
      entries: Array.isArray(timelineIndex.entries) ? timelineIndex.entries : [],
    },
  };
}

/**
 * Normalize point render metadata crossing the Electron IPC boundary.
 */
function normalizePointFeature(point) {
  if (!point || typeof point !== "object") {
    return {
      renderType: "exact",
      count: 1,
      groupId: null,
      groupRef: null,
    };
  }

  return {
    ...point,
    renderType: normalizePointRenderType(point.renderType),
    count: normalizePositiveInteger(point.count, 1),
    groupId: normalizeNullableString(point.groupId),
    groupRef: normalizeGroupRef(point.groupRef),
  };
}

function normalizePointRenderType(value) {
  if (value === "grouped" || value === "representative") {
    return value;
  }

  return "exact";
}

function normalizeFeatureDetailsResult(result) {
  if (!result || typeof result !== 'object') {
    return createEmptyFeatureDetailsResult();
  }

  return {
    featureId: normalizeNullableString(result.featureId),
    row: normalizeRecord(result.row),
    latField: normalizeNullableString(result.latField),
    lonField: normalizeNullableString(result.lonField),
  };
}

// Validate detail IPC results before they reach React components.
function normalizeGroupRowsResult(result, requestedOffset, requestedLimit) {
  if (!result || typeof result !== 'object') {
    return createEmptyGroupRowsResult(requestedOffset, requestedLimit);
  }

  const rows = Array.isArray(result.rows)
    ? result.rows.map(normalizeRecord).filter(Boolean)
    : [];

  return {
    rows,
    offset: normalizeNonNegativeInteger(
      result.offset ?? requestedOffset,
      requestedOffset,
    ),
    limit: normalizePositiveInteger(
      result.limit ?? requestedLimit,
      requestedLimit,
    ),
    totalRows: normalizeNonNegativeInteger(
      result.totalRows ?? rows.length,
      rows.length,
    ),
  };
}

function normalizeFeatureSourceRef(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'object') return null;

  const datasetId = normalizeNullableString(sourceRef.datasetId);
  const rowIndex = normalizeOptionalNonNegativeInteger(sourceRef.rowIndex);
  if (!datasetId || rowIndex == null) return null;

  return { datasetId, rowIndex };
}

function normalizeGroupRef(groupRef) {
  if (!groupRef || typeof groupRef !== 'object') return null;

  const groupId = normalizeNullableString(groupRef.groupId);
  const bounds = normalizeGroupBounds(groupRef.bounds);
  const timeline = normalizeGroupTimeline(groupRef.timeline);
  const grid = normalizeGroupGrid(groupRef.grid);

  if (
    !groupId ||
    !bounds ||
    timeline === undefined ||
    !grid ||
    groupRef.sortOrder !== 'dataset-source-row'
  ) {
    return null;
  }

  // A mismatched group ID is unsafe because it could broaden the requested rows.
  if (groupId !== ['grid', grid.cellLat, grid.cellLon].join(':')) {
    return null;
  }

  return {
    groupId,
    bounds,
    timeline,
    grid,
    sortOrder: 'dataset-source-row',
  };
}

function normalizeGroupBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;

  const north = normalizeFiniteNumber(bounds.north);
  const south = normalizeFiniteNumber(bounds.south);
  const east = normalizeFiniteNumber(bounds.east);
  const west = normalizeFiniteNumber(bounds.west);
  if (north == null || south == null || east == null || west == null) {
    return null;
  }

  return { north, south, east, west };
}

function normalizeGroupTimeline(timeline) {
  if (!timeline?.timelineEnabled) return null;

  const startYear = normalizeOptionalInteger(timeline.startYear);
  const endYear = normalizeOptionalInteger(timeline.endYear);
  if (startYear == null || endYear == null) return undefined;

  return {
    timelineEnabled: true,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function normalizeGroupGrid(grid) {
  if (!grid || typeof grid !== 'object') return null;

  const cellLat = normalizeOptionalInteger(grid.cellLat);
  const cellLon = normalizeOptionalInteger(grid.cellLon);
  const cellHeight = normalizePositiveNumber(grid.cellHeight);
  const cellWidth = normalizePositiveNumber(grid.cellWidth);
  if (
    cellLat == null ||
    cellLon == null ||
    cellHeight == null ||
    cellWidth == null
  ) {
    return null;
  }

  return { cellLat, cellLon, cellHeight, cellWidth };
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function normalizeStats(stats, returnedCount) {
  const normalizedStats = stats && typeof stats === "object" ? stats : {};
  const totalMatchingCount = normalizeNonNegativeInteger(
    normalizedStats.totalMatchingCount,
    returnedCount,
  );
  const normalizedReturnedCount = normalizeNonNegativeInteger(
    normalizedStats.returnedCount,
    returnedCount,
  );
  const hiddenByRenderBudget = normalizeNonNegativeInteger(
    normalizedStats.hiddenByRenderBudget,
    Math.max(0, totalMatchingCount - normalizedReturnedCount),
  );
  const skippedPointsByTimeline = normalizeNonNegativeInteger(
    normalizedStats.skippedPointsByTimeline,
    0,
  );
  const skippedLinesByTimeline = normalizeNonNegativeInteger(
    normalizedStats.skippedLinesByTimeline,
    0,
  );
  const skippedRegionsByTimeline = normalizeNonNegativeInteger(
    normalizedStats.skippedRegionsByTimeline,
    0,
  );

  return {
    skippedPoints: normalizeNonNegativeInteger(normalizedStats.skippedPoints, 0),
    skippedLines: normalizeNonNegativeInteger(normalizedStats.skippedLines, 0),
    skippedRegions: normalizeNonNegativeInteger(normalizedStats.skippedRegions, 0),
    skippedPointsByTimeline,
    skippedLinesByTimeline,
    skippedRegionsByTimeline,
    skippedByTimeline: normalizeNonNegativeInteger(
      normalizedStats.skippedByTimeline,
      skippedPointsByTimeline + skippedLinesByTimeline + skippedRegionsByTimeline,
    ),
    limitedToRenderBudget: normalizedStats.limitedToRenderBudget ?? null,
    totalMatchingCount,
    returnedCount: normalizedReturnedCount,
    hiddenByRenderBudget,
    overBudget: Boolean(normalizedStats.overBudget ?? hiddenByRenderBudget > 0),
  };
}

function createEmptyFeatureDetailsResult() {
  return {
    featureId: null,
    row: null,
    latField: null,
    lonField: null,
  };
}

function createEmptyGroupRowsResult(offset, limit) {
  return {
    rows: [],
    offset,
    limit,
    totalRows: 0,
  };
}

function createEmptyDatasetSummary() {
  return {
    datasets: [],
    timeline: null,
  };
}

function createDatasetMutationResult(updated) {
  return {
    updated: updated === true,
  };
}

function createDatasetRemovalResult(removed) {
  return {
    removed: removed === true,
  };
}

function createEmptyMapViewResult() {
  return {
    points: [],
    lines: [],
    regions: [],
    stats: {
      skippedPoints: 0,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline: 0,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      skippedByTimeline: 0,
      limitedToRenderBudget: null,
      totalMatchingCount: 0,
      returnedCount: 0,
      hiddenByRenderBudget: 0,
      overBudget: false,
    },
    timelineIndex: {
      entries: [],
    },
  };
}

function normalizeOptionalNonNegativeInteger(value) {
  const number = normalizeFiniteNumber(value);
  if (number == null || number < 0) return null;
  return Math.trunc(number);
}

function normalizeOptionalInteger(value) {
  const number = normalizeFiniteNumber(value);
  if (number == null) return null;
  return Math.trunc(number);
}

function normalizePositiveNumber(value) {
  const number = normalizeFiniteNumber(value);
  if (number == null || number <= 0) return null;
  return number;
}

function normalizeFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;

  const integer = Math.trunc(number);
  return integer > 0 ? integer : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(number));
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;

  const stringValue = String(value);
  return stringValue.trim() ? stringValue : null;
}
