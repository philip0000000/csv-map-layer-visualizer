"use strict";

const DEFAULT_RENDER_BUDGET = 1000;
const MAX_RENDER_BUDGET = 10000;
const DEFAULT_IMAGE_SIZE_METERS = 100;
const MIN_IMAGE_SIZE_METERS = 1;
const MAX_IMAGE_SIZE_METERS = 100000;

/**
 * Query compact point render data from the desktop SQLite store.
 * This intentionally avoids row_json; full detail lookup belongs to a later issue.
 */
function querySqliteMapView({ db, bounds, timeline = null, renderBudget = DEFAULT_RENDER_BUDGET }) {
  if (!db?.open) {
    throw new TypeError("An open SQLite database is required.");
  }

  const normalizedBounds = normalizeBounds(bounds);
  const budget = normalizeRenderBudget(renderBudget);

  if (!normalizedBounds) {
    return createEmptyMapViewResult({
      limitedToRenderBudget: null,
      totalMatchingCount: 0,
      skippedPointsByTimeline: 0,
    });
  }

  const filter = buildWhereClause({ bounds: normalizedBounds, timeline });
  // Count first so the UI can explain how many matching datapoints are hidden by the render budget.
  const totalMatchingCount = countMatchingFeatures(db, filter);
  const boundsOnlyCount = filter.usesTimeline ? countMatchingFeatures(db, filter.boundsOnly) : totalMatchingCount;
  const rows = selectMatchingFeatures(db, filter, budget);
  const returnedCount = rows.length;
  const hiddenByRenderBudget = Math.max(0, totalMatchingCount - returnedCount);
  const skippedPointsByTimeline = Math.max(0, boundsOnlyCount - totalMatchingCount);

  return {
    points: rows.map(rowToPointFeature),
    lines: [],
    regions: [],
    stats: {
      skippedPoints: 0,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      skippedByTimeline: skippedPointsByTimeline,
      limitedToRenderBudget: hiddenByRenderBudget > 0 ? budget : null,
      totalMatchingCount,
      returnedCount,
      hiddenByRenderBudget,
      overBudget: hiddenByRenderBudget > 0,
    },
    timelineIndex: {
      entries: [],
    },
  };
}

function countMatchingFeatures(db, filter) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM features ${filter.sql}`).get(filter.params);
  return normalizeCount(row?.count);
}

function selectMatchingFeatures(db, filter, renderBudget) {
  return db.prepare(`
    SELECT
      id,
      dataset_id,
      source_row_index,
      lat,
      lon,
      timeline_start_year,
      timeline_end_year,
      compact_json
    FROM features
    ${filter.sql}
    -- Keep the query order stable when the render budget hides part of the result set.
    ORDER BY dataset_id, source_row_index
    LIMIT @limit
  `).all({
    ...filter.params,
    limit: renderBudget,
  });
}

function buildWhereClause({ bounds, timeline }) {
  const boundsFilter = buildBoundsFilter(bounds);
  const timelineFilter = buildTimelineFilter(timeline);
  const clauses = [...boundsFilter.clauses, ...timelineFilter.clauses];
  const params = {
    ...boundsFilter.params,
    ...timelineFilter.params,
  };

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    usesTimeline: timelineFilter.usesTimeline,
    // Build the bounds-only filter once so skipped-by-timeline can stay cheap and consistent.
    boundsOnly: {
      sql: boundsFilter.clauses.length > 0 ? `WHERE ${boundsFilter.clauses.join(" AND ")}` : "",
      params: boundsFilter.params,
    },
  };
}

function buildBoundsFilter(bounds) {
  const clauses = ["lat BETWEEN @south AND @north"];
  const params = {
    north: bounds.north,
    south: bounds.south,
    east: bounds.east,
    west: bounds.west,
  };

  // Leaflet can report wrapped viewports where west is greater than east.
  if (bounds.crossesAntimeridian) {
    clauses.push("(lon >= @west OR lon <= @east)");
  } else {
    clauses.push("lon BETWEEN @west AND @east");
  }

  return { clauses, params };
}

function buildTimelineFilter(timeline) {
  if (!timeline?.timelineEnabled) {
    return { clauses: [], params: {}, usesTimeline: false };
  }

  const startYear = normalizeYear(timeline.startYear);
  const endYear = normalizeYear(timeline.endYear);

  if (startYear == null || endYear == null) {
    return { clauses: [], params: {}, usesTimeline: false };
  }

  return {
    // Range overlap keeps multi-year rows visible when any part intersects the selected timeline.
    clauses: [
      "timeline_start_year IS NOT NULL",
      "timeline_end_year IS NOT NULL",
      "timeline_start_year <= @timelineEndYear",
      "timeline_end_year >= @timelineStartYear",
    ],
    params: {
      timelineStartYear: Math.min(startYear, endYear),
      timelineEndYear: Math.max(startYear, endYear),
    },
    usesTimeline: true,
  };
}

function rowToPointFeature(row) {
  const compactFields = parseCompactFields(row.compact_json);

  return {
    id: String(row.id),
    lat: Number(row.lat),
    lon: Number(row.lon),
    sourceRef: {
      datasetId: String(row.dataset_id),
      rowIndex: normalizeCount(row.source_row_index),
    },
    // Keep legacy refs available while the map popup code is still being migrated.
    sourceFileId: String(row.dataset_id),
    sourceRowIndex: normalizeCount(row.source_row_index),
    marker: getNullableString(compactFields.marker),
    image: getNullableString(compactFields.image),
    imageWidthMeters: normalizeImageSizeMeters(compactFields.imageWidthMeters),
    imageHeightMeters: normalizeImageSizeMeters(compactFields.imageHeightMeters),
    latField: getNullableString(compactFields.latField),
    lonField: getNullableString(compactFields.lonField),
    compactFields,
  };
}

function parseCompactFields(value) {
  if (!value || typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;

  const north = normalizeLatitude(bounds.north);
  const south = normalizeLatitude(bounds.south);
  const east = normalizeLongitude(bounds.east);
  const west = normalizeLongitude(bounds.west);

  if (north == null || south == null || east == null || west == null) {
    return null;
  }

  return {
    north: Math.max(north, south),
    south: Math.min(north, south),
    east,
    west,
    crossesAntimeridian: west > east,
  };
}

function normalizeLatitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(-90, Math.min(90, number));
}

function normalizeLongitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  if (number >= -180 && number <= 180) return number;

  return ((((number + 180) % 360) + 360) % 360) - 180;
}

function normalizeImageSizeMeters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_IMAGE_SIZE_METERS;
  return Math.min(MAX_IMAGE_SIZE_METERS, Math.max(MIN_IMAGE_SIZE_METERS, number));
}
function normalizeRenderBudget(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_RENDER_BUDGET;
  return Math.min(number, MAX_RENDER_BUDGET);
}

function normalizeYear(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  return Math.trunc(number);
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getNullableString(value) {
  if (value === null || value === undefined) return null;

  const stringValue = String(value);
  return stringValue.trim() ? stringValue : null;
}

function createEmptyMapViewResult({
  limitedToRenderBudget,
  totalMatchingCount,
  skippedPointsByTimeline,
}) {
  return {
    points: [],
    lines: [],
    regions: [],
    stats: {
      skippedPoints: 0,
      skippedLines: 0,
      skippedRegions: 0,
      skippedPointsByTimeline,
      skippedLinesByTimeline: 0,
      skippedRegionsByTimeline: 0,
      skippedByTimeline: skippedPointsByTimeline,
      limitedToRenderBudget,
      totalMatchingCount,
      returnedCount: 0,
      hiddenByRenderBudget: 0,
      overBudget: false,
    },
    timelineIndex: {
      entries: [],
    },
  };
}

module.exports = {
  DEFAULT_RENDER_BUDGET,
  querySqliteMapView,
};
