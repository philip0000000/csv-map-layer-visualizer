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

    getFeatureDetails(query = {}) {
      return {
        featureId: query.featureId ?? null,
        row: null,
        latField: null,
        lonField: null,
      };
    },

    getGroupRows(query = {}) {
      const offset = normalizeNonNegativeInteger(query.offset, 0);
      const limit = normalizeNonNegativeInteger(query.limit, 0);

      return {
        rows: [],
        offset,
        limit,
        totalRows: null,
      };
    },

    getDatasetSummary() {
      return {
        datasets: [],
        timeline: null,
      };
    },
  };
}

function normalizeMapViewResult(result) {
  if (!result || typeof result !== "object") {
    return createEmptyMapViewResult();
  }

  const points = Array.isArray(result.points) ? result.points : [];
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

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(number));
}
