"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const ELECTRON_VALIDATION_CHILD = "CSV_MAP_LARGE_FILE_VALIDATION_CHILD";
const CSV_HEADER = "name,latitude,longitude,yearFrom,yearTo,marker,comment";
const ROW_COUNT = 30000;
const DENSE_ROW_COUNT = 24000;
const QUERY_ITERATIONS = 5;
const RENDER_BUDGET = 1000;
const SPARSE_VIEWPORT_ROW_COUNT = 272;
const TIMELINE_MATCHING_ROW_COUNT = 5418;
const TIMELINE_SKIPPED_ROW_COUNT = 18582;

/**
 * Exercise the production import and query services against an isolated,
 * file-backed database, then report the measurements used by issue #85.
 */
function runValidationFoundation() {
  const { importCsvFileToSqlite } = require("./csvImportService.cjs");
  const { closeSqliteStore, openSqliteStore } = require("./sqliteStore.cjs");
  const {
    getSqliteFeatureDetails,
    getSqliteGroupRows,
  } = require("./sqliteDetailQuery.cjs");
  const { querySqliteMapView } = require("./sqliteViewportQuery.cjs");
  const validationDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "csv-map-large-file-validation-"),
  );
  const csvPath = path.join(validationDir, "desktop-large-file-30k.csv");
  const dbPath = path.join(validationDir, "desktop-large-file.sqlite");
  const keepFiles = process.argv.includes("--keep-files");
  let db = null;

  try {
    if (!fs.existsSync(validationDir)) {
      throw new Error("Validation temporary directory was not created.");
    }

    // Generate the large fixture per run so the repository does not carry a
    // permanent 30k-row data file.
    generateValidationCsv(csvPath);
    verifyValidationCsv(csvPath);

    const csvSizeBytes = fs.statSync(csvPath).size;
    // This is a coarse main-process heap delta around import. It is useful for
    // repeatability checks, but it is neither renderer memory nor a peak value.
    const heapBeforeImport = process.memoryUsage().heapUsed;
    db = openSqliteStore(dbPath);
    const importStartedAt = performance.now();
    const importSummary = importCsvFileToSqlite({ db, filePath: csvPath });
    const importDurationMs = performance.now() - importStartedAt;
    const heapAfterImport = process.memoryUsage().heapUsed;

    assert.equal(importSummary.ok, true);
    assert.equal(importSummary.rowCount, ROW_COUNT);
    assert.equal(importSummary.importedFeatureCount, ROW_COUNT);
    assert.equal(importSummary.skippedRowCount, 0);

    // Move committed WAL pages into the main file before reporting its size.
    db.pragma("wal_checkpoint(TRUNCATE)");
    const sqliteSizeBytes = getSqliteSizeBytes(dbPath);
    assert.ok(sqliteSizeBytes > 0);

    // The dense region deliberately exceeds the render budget and must take
    // the grouped-marker path.
    const denseQuery = {
      bounds: { north: 59.5, south: 59.2, east: 18.2, west: 17.9 },
      renderBudget: RENDER_BUDGET,
    };
    const denseCold = measureOnce(() => querySqliteMapView({
      db,
      ...denseQuery,
    }));
    const denseWarm = measureRepeated(
      () => querySqliteMapView({ db, ...denseQuery }),
      QUERY_ITERATIONS,
    );
    const denseResult = denseWarm.value;

    assert.equal(denseResult.stats.totalMatchingCount, DENSE_ROW_COUNT);
    assert.equal(denseResult.stats.overBudget, true);
    assert.ok(denseResult.points.length > 0);
    assert.ok(denseResult.points.length <= RENDER_BUDGET);
    assert.ok(denseResult.points.some((point) => point.renderType === "grouped"));
    assertStableGroupedResults(denseCold.value, denseResult);

    // The exact region stays below budget, preserving stable source references
    // for on-demand detail lookup.
    const exactQuery = {
      bounds: { north: -33.8, south: -34, east: 151.3, west: 151.1 },
      renderBudget: RENDER_BUDGET,
    };
    const exactCold = measureOnce(() => querySqliteMapView({
      db,
      ...exactQuery,
    }));
    const exactWarm = measureRepeated(
      () => querySqliteMapView({ db, ...exactQuery }),
      QUERY_ITERATIONS,
    );
    const exactResult = exactWarm.value;

    assert.equal(exactResult.stats.totalMatchingCount, 400);
    assert.equal(exactResult.stats.overBudget, false);
    assert.equal(exactResult.points.length, 400);
    assert.ok(exactResult.points.every((point) => point.renderType === "exact"));
    assert.ok(exactResult.points.every(hasStableSourceRef));
    assertStableExactResults(exactCold.value, exactResult);

    // Sparse and empty bounds cover the inexpensive viewport cases that occur
    // during normal map navigation.
    const sparseQuery = {
      bounds: { north: 48, south: 45, east: 5, west: 0 },
      renderBudget: RENDER_BUDGET,
    };
    const sparseCold = measureOnce(() => querySqliteMapView({
      db,
      ...sparseQuery,
    }));
    const sparseWarm = measureRepeated(
      () => querySqliteMapView({ db, ...sparseQuery }),
      QUERY_ITERATIONS,
    );
    const sparseResult = sparseWarm.value;

    assert.equal(
      sparseResult.stats.totalMatchingCount,
      SPARSE_VIEWPORT_ROW_COUNT,
    );
    assert.equal(sparseResult.stats.overBudget, false);
    assert.equal(sparseResult.points.length, SPARSE_VIEWPORT_ROW_COUNT);
    assert.ok(sparseResult.points.every((point) => point.renderType === "exact"));
    assert.ok(sparseResult.points.every(hasStableSourceRef));
    assertStableExactResults(sparseCold.value, sparseResult);

    const emptyQuery = {
      bounds: { north: 10, south: 0, east: 10, west: 0 },
      renderBudget: RENDER_BUDGET,
    };
    const emptyCold = measureOnce(() => querySqliteMapView({
      db,
      ...emptyQuery,
    }));
    const emptyWarm = measureRepeated(
      () => querySqliteMapView({ db, ...emptyQuery }),
      QUERY_ITERATIONS,
    );
    const emptyResult = emptyWarm.value;

    assert.equal(emptyResult.stats.totalMatchingCount, 0);
    assert.equal(emptyResult.stats.returnedCount, 0);
    assert.equal(emptyResult.stats.hiddenByRenderBudget, 0);
    assert.equal(emptyResult.stats.overBudget, false);
    assert.deepEqual(emptyResult.points, []);
    assert.deepEqual(emptyResult.lines, []);
    assert.deepEqual(emptyResult.regions, []);
    assert.deepEqual(emptyResult, emptyCold.value);

    // Timeline filtering must happen before grouping, and the resulting group
    // reference must retain the filter for later paging queries.
    const timeline = {
      timelineEnabled: true,
      startYear: 2000,
      endYear: 2005,
    };
    const timelineCold = measureOnce(() => querySqliteMapView({
      db,
      ...denseQuery,
      timeline,
    }));
    const timelineWarm = measureRepeated(
      () => querySqliteMapView({ db, ...denseQuery, timeline }),
      QUERY_ITERATIONS,
    );
    const timelineResult = timelineWarm.value;

    assert.equal(
      timelineResult.stats.totalMatchingCount,
      TIMELINE_MATCHING_ROW_COUNT,
    );
    assert.equal(
      timelineResult.stats.skippedPointsByTimeline,
      TIMELINE_SKIPPED_ROW_COUNT,
    );
    assert.equal(timelineResult.stats.overBudget, true);
    assert.ok(timelineResult.points.length > 0);
    assert.ok(timelineResult.points.length <= RENDER_BUDGET);
    assert.ok(
      timelineResult.points.some((point) => point.renderType === "grouped"),
    );
    timelineResult.points.forEach((point) => {
      assert.deepEqual(point.groupRef?.timeline, timeline);
    });
    assertStableGroupedResults(timelineCold.value, timelineResult);

    // Viewport results intentionally omit full CSV rows; details are fetched
    // only after the user selects an exact marker.
    const selectedExactPoint = exactResult.points[0];
    assert.equal(Object.hasOwn(selectedExactPoint, "row"), false);
    assert.equal(Object.hasOwn(selectedExactPoint, "fullRow"), false);
    assert.equal(Object.hasOwn(selectedExactPoint, "details"), false);

    const exactDetailCold = measureOnce(() => getSqliteFeatureDetails({
      db,
      sourceRef: selectedExactPoint.sourceRef,
    }));
    const exactDetailWarm = measureRepeated(
      () => getSqliteFeatureDetails({
        db,
        sourceRef: selectedExactPoint.sourceRef,
      }),
      QUERY_ITERATIONS,
    );
    const exactDetail = exactDetailWarm.value;

    assert.equal(exactDetail.featureId, selectedExactPoint.id);
    assert.equal(exactDetail.latField, "latitude");
    assert.equal(exactDetail.lonField, "longitude");
    assert.deepEqual(exactDetail.row, {
      name: "exact-0",
      latitude: "-33.900000",
      longitude: "151.150000",
      yearFrom: "2016",
      yearTo: "2018",
      marker: "blue",
      comment: "validation row 29600",
    });
    assert.deepEqual(exactDetail, exactDetailCold.value);

    // Reuse a timeline-aware group reference to prove consecutive pages are
    // deterministic, non-overlapping, and still respect the active filter.
    const pagedGroup = timelineResult.points.find((point) => point.count > 60);
    assert.ok(pagedGroup?.groupRef, "Expected a timeline group with two full pages.");

    const firstPageQuery = {
      db,
      groupRef: pagedGroup.groupRef,
      offset: 0,
      limit: 30,
    };
    const firstPageCold = measureOnce(() => getSqliteGroupRows(firstPageQuery));
    const firstPageWarm = measureRepeated(
      () => getSqliteGroupRows(firstPageQuery),
      QUERY_ITERATIONS,
    );
    const firstPage = firstPageWarm.value;

    const secondPageQuery = {
      db,
      groupRef: pagedGroup.groupRef,
      offset: 30,
      limit: 30,
    };
    const secondPageCold = measureOnce(() => getSqliteGroupRows(secondPageQuery));
    const secondPageWarm = measureRepeated(
      () => getSqliteGroupRows(secondPageQuery),
      QUERY_ITERATIONS,
    );
    const secondPage = secondPageWarm.value;

    assert.equal(firstPage.rows.length, 30);
    assert.equal(secondPage.rows.length, 30);
    assert.equal(firstPage.totalRows, pagedGroup.count);
    assert.equal(secondPage.totalRows, pagedGroup.count);
    assert.deepEqual(firstPage, firstPageCold.value);
    assert.deepEqual(secondPage, secondPageCold.value);
    assertPagesDoNotOverlap(firstPage.rows, secondPage.rows);
    [...firstPage.rows, ...secondPage.rows].forEach(assertRowOverlapsTimeline);

    console.log("Desktop large-file workflow validation passed.");
    console.log(JSON.stringify({
      rows: ROW_COUNT,
      csvSizeBytes,
      sqliteSizeBytes,
      importDurationMs: round(importDurationMs),
      approximateHeapMiB: {
        beforeImport: toMiB(heapBeforeImport),
        afterImport: toMiB(heapAfterImport),
        delta: toMiB(heapAfterImport - heapBeforeImport),
      },
      denseViewport: {
        matchingRows: denseResult.stats.totalMatchingCount,
        renderPoints: denseResult.points.length,
        coldMs: round(denseCold.durationMs),
        warmMs: toTimingSummary(denseWarm),
      },
      exactViewport: {
        matchingRows: exactResult.stats.totalMatchingCount,
        renderPoints: exactResult.points.length,
        coldMs: round(exactCold.durationMs),
        warmMs: toTimingSummary(exactWarm),
      },
      sparseViewport: {
        matchingRows: sparseResult.stats.totalMatchingCount,
        renderPoints: sparseResult.points.length,
        coldMs: round(sparseCold.durationMs),
        warmMs: toTimingSummary(sparseWarm),
      },
      emptyViewport: {
        matchingRows: emptyResult.stats.totalMatchingCount,
        renderPoints: emptyResult.points.length,
        coldMs: round(emptyCold.durationMs),
        warmMs: toTimingSummary(emptyWarm),
      },
      timelineViewport: {
        matchingRows: timelineResult.stats.totalMatchingCount,
        skippedRows: timelineResult.stats.skippedPointsByTimeline,
        renderPoints: timelineResult.points.length,
        coldMs: round(timelineCold.durationMs),
        warmMs: toTimingSummary(timelineWarm),
      },
      exactDetail: {
        featureId: exactDetail.featureId,
        coldMs: round(exactDetailCold.durationMs),
        warmMs: toTimingSummary(exactDetailWarm),
      },
      groupPaging: {
        groupId: pagedGroup.groupId,
        totalRows: pagedGroup.count,
        pageSize: 30,
        firstPageColdMs: round(firstPageCold.durationMs),
        firstPageWarmMs: toTimingSummary(firstPageWarm),
        secondPageColdMs: round(secondPageCold.durationMs),
        secondPageWarmMs: toTimingSummary(secondPageWarm),
      },
    }, null, 2));
  } finally {
    closeSqliteStore(db);
    if (keepFiles) {
      console.log(`Validation directory kept temporarily: ${validationDir}`);
      console.log(`Manual test CSV: ${csvPath}`);
    } else {
      // This directory is unique to this run and never contains user data.
      fs.rmSync(validationDir, { recursive: true, force: true });
    }
  }

  if (!keepFiles && fs.existsSync(validationDir)) {
    throw new Error("Validation temporary directory was not removed.");
  }
}

/**
 * Generate stable dense, sparse, and exact-result regions without committing a fixture.
 */
function generateValidationCsv(csvPath) {
  const file = fs.openSync(csvPath, "w");

  try {
    fs.writeSync(file, `${CSV_HEADER}\n`);

    const chunk = [];
    for (let index = 0; index < ROW_COUNT; index += 1) {
      chunk.push(createCsvRow(index));

      if (chunk.length === 1000) {
        fs.writeSync(file, chunk.join(""));
        chunk.length = 0;
      }
    }

    if (chunk.length > 0) {
      fs.writeSync(file, chunk.join(""));
    }
  } finally {
    fs.closeSync(file);
  }
}

function createCsvRow(index) {
  let region;
  let regionIndex;
  let latitude;
  let longitude;

  // Split the fixture into one over-budget cluster, a broad navigation field,
  // and one compact under-budget cluster for exact-marker assertions.
  if (index < 24000) {
    region = "dense";
    regionIndex = index;
    latitude = 59.3 + (regionIndex % 120) * 0.0002;
    longitude = 18 + (Math.floor(regionIndex / 120) % 120) * 0.0002;
  } else if (index < 29600) {
    region = "sparse";
    regionIndex = index - 24000;
    latitude = 40 + (regionIndex % 70) * 0.2;
    longitude = -10 + (Math.floor(regionIndex / 70) % 80) * 0.3;
  } else {
    region = "exact";
    regionIndex = index - 29600;
    latitude = -33.9 + (regionIndex % 20) * 0.001;
    longitude = 151.15 + Math.floor(regionIndex / 20) * 0.001;
  }

  // Cycling a fixed year range produces a deterministic number of matches for
  // the 2000-2005 timeline scenario.
  const yearFrom = 1990 + (index % 31);
  const yearTo = yearFrom + (index % 3);
  const marker = ["blue", "red", "green", "purple"][index % 4];

  return [
    `${region}-${regionIndex}`,
    latitude.toFixed(6),
    longitude.toFixed(6),
    yearFrom,
    yearTo,
    marker,
    `validation row ${index}`,
  ].join(",") + "\n";
}

// Fail before import if fixture generation produced the wrong shape.
function verifyValidationCsv(csvPath) {
  const csvText = fs.readFileSync(csvPath, "utf8");
  const lines = csvText.trimEnd().split("\n");

  assert.equal(lines[0], CSV_HEADER);
  assert.equal(lines.length - 1, ROW_COUNT);
  assert.ok(fs.statSync(csvPath).size > 0);
}

// Include sidecars so the reported on-disk footprint stays correct even if a
// future SQLite configuration leaves committed pages in WAL or SHM files.
function getSqliteSizeBytes(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].reduce((total, filePath) => {
    return total + (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
  }, 0);
}

function measureOnce(action) {
  const startedAt = performance.now();
  const value = action();
  return { value, durationMs: performance.now() - startedAt };
}

// Repeat identical warm queries and retain the final result for assertions.
function measureRepeated(action, iterations) {
  const durationsMs = [];
  let value = null;

  for (let index = 0; index < iterations; index += 1) {
    const measurement = measureOnce(action);
    durationsMs.push(measurement.durationMs);
    value = measurement.value;
  }

  return { value, durationsMs };
}

function assertStableGroupedResults(first, second) {
  // Compare user-visible grouping identity without coupling the test to
  // unrelated diagnostic fields.
  const project = (result) => result.points.map((point) => ({
    id: point.id,
    renderType: point.renderType,
    count: point.count,
    lat: point.lat,
    lon: point.lon,
    marker: point.marker,
    groupRef: point.groupRef,
  }));

  assert.deepEqual(project(second), project(first));
}

function assertStableExactResults(first, second) {
  // Exact results are stable when marker identity, position, and lookup
  // reference remain unchanged between cold and warm executions.
  const project = (result) => result.points.map((point) => ({
    id: point.id,
    renderType: point.renderType,
    lat: point.lat,
    lon: point.lon,
    marker: point.marker,
    sourceRef: point.sourceRef,
  }));

  assert.deepEqual(project(second), project(first));
}

function hasStableSourceRef(point) {
  return (
    typeof point.sourceRef?.datasetId === "string" &&
    Number.isInteger(point.sourceRef?.rowIndex)
  );
}

function assertPagesDoNotOverlap(firstPage, secondPage) {
  const firstNames = new Set(firstPage.map((row) => row.name));
  secondPage.forEach((row) => {
    assert.equal(firstNames.has(row.name), false, `Duplicate paged row ${row.name}.`);
  });
}

function assertRowOverlapsTimeline(row) {
  const startYear = Number(row.yearFrom);
  const endYear = Number(row.yearTo);
  assert.ok(startYear <= 2005 && endYear >= 2000);
}

function toTimingSummary(measurement) {
  // The median is the middle observed run; QUERY_ITERATIONS is intentionally odd.
  const sorted = [...measurement.durationsMs].sort((a, b) => a - b);
  return {
    min: round(sorted[0]),
    median: round(sorted[Math.floor(sorted.length / 2)]),
    max: round(sorted[sorted.length - 1]),
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function toMiB(bytes) {
  return round(bytes / 1024 / 1024);
}

/**
 * Relaunch in Electron's Node mode so later SQLite checks use Electron's ABI.
 */
function runInElectronNode() {
  const electronPath = require("electron");
  // Forward validation flags, such as --keep-files, to the Electron child.
  const result = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      [ELECTRON_VALIDATION_CHILD]: "1",
    },
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(
      `Electron validation process stopped by signal ${result.signal}.`,
    );
  }

  process.exitCode = result.status ?? 1;
}

function main() {
  try {
    if (process.env[ELECTRON_VALIDATION_CHILD] !== "1") {
      runInElectronNode();
      return;
    }

    if (!process.versions.electron) {
      throw new Error("Large-file validation did not start in Electron's Node mode.");
    }

    runValidationFoundation();
  } catch (error) {
    console.error("Desktop large-file validation failed.", error);
    process.exitCode = 1;
  }
}

main();
