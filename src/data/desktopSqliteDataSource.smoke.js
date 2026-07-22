import assert from "node:assert/strict";
import { createDesktopSqliteDataSource } from "./desktopSqliteDataSource.js";

const unavailable = createDesktopSqliteDataSource({ desktopApi: null });
assert.deepEqual(await unavailable.getDatasetSummary(), {
  datasets: [],
  timeline: null,
});

const malformed = createDesktopSqliteDataSource({
  desktopApi: {
    getDatasetSummary: async () => null,
  },
});
assert.deepEqual(await malformed.getDatasetSummary(), {
  datasets: [],
  timeline: null,
});

const dataSource = createDesktopSqliteDataSource({
  desktopApi: {
    getDatasetSummary: async () => ({
      datasets: [
        {
          id: "dataset-1",
          name: "places.csv",
          enabled: true,
          headers: ["name", 42, "lat", "lon"],
          rowCount: "12",
          totalRows: 12.8,
          importedFeatureCount: 10,
          skippedRowCount: -2,
          importedAt: "2026-07-22T00:00:00.000Z",
        },
        { id: "", name: "invalid.csv" },
        null,
      ],
      timeline: { yearMin: "1000", yearMax: 2026.9 },
    }),
  },
});

assert.deepEqual(await dataSource.getDatasetSummary(), {
  datasets: [
    {
      id: "dataset-1",
      name: "places.csv",
      enabled: true,
      headers: ["name", "lat", "lon"],
      rowCount: 12,
      totalRows: 12,
      importedFeatureCount: 10,
      skippedRowCount: 0,
      importedAt: "2026-07-22T00:00:00.000Z",
      latField: null,
      lonField: null,
      parseErrors: [],
    },
  ],
  timeline: { yearMin: 1000, yearMax: 2026 },
});

let visibilityRequest = null;
const visibilityDataSource = createDesktopSqliteDataSource({
  desktopApi: {
    setDatasetEnabled: async (datasetId, enabled) => {
      visibilityRequest = { datasetId, enabled };
      return { updated: true, unexpected: "ignored" };
    },
  },
});
assert.deepEqual(
  await visibilityDataSource.setDatasetEnabled(" dataset-1 ", false),
  { updated: true },
);
assert.deepEqual(visibilityRequest, {
  datasetId: "dataset-1",
  enabled: false,
});

visibilityRequest = null;
assert.deepEqual(
  await visibilityDataSource.setDatasetEnabled("", true),
  { updated: false },
);
assert.deepEqual(
  await visibilityDataSource.setDatasetEnabled("dataset-1", 1),
  { updated: false },
);
assert.equal(visibilityRequest, null);

const malformedVisibilityResult = createDesktopSqliteDataSource({
  desktopApi: {
    setDatasetEnabled: async () => ({ updated: "yes" }),
  },
});
assert.deepEqual(
  await malformedVisibilityResult.setDatasetEnabled("dataset-1", true),
  { updated: false },
);
assert.deepEqual(
  await unavailable.setDatasetEnabled("dataset-1", true),
  { updated: false },
);

let removalRequest = null;
const removalDataSource = createDesktopSqliteDataSource({
  desktopApi: {
    removeDataset: async (datasetId) => {
      removalRequest = datasetId;
      return { removed: true, unexpected: "ignored" };
    },
  },
});
assert.deepEqual(
  await removalDataSource.removeDataset(" dataset-1 "),
  { removed: true },
);
assert.equal(removalRequest, "dataset-1");

removalRequest = null;
assert.deepEqual(
  await removalDataSource.removeDataset(" "),
  { removed: false },
);
assert.equal(removalRequest, null);

const malformedRemovalResult = createDesktopSqliteDataSource({
  desktopApi: {
    removeDataset: async () => ({ removed: "yes" }),
  },
});
assert.deepEqual(
  await malformedRemovalResult.removeDataset("dataset-1"),
  { removed: false },
);
assert.deepEqual(
  await unavailable.removeDataset("dataset-1"),
  { removed: false },
);

console.log("Desktop SQLite dataset adapter smoke test passed.");
