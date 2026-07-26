import {
  createBrowserSqliteDataSource,
} from './browserSqliteDataSource.js';

const LARGE_ROW_COUNT = 30_000;
const CANCEL_ROW_COUNT = 120_000;
const resultElement = document.querySelector('#validation-result');

try {
  const result = await runRealBrowserValidation();
  globalThis.__browserSqliteValidationResult = {
    status: 'passed',
    ...result,
  };
  resultElement.textContent = JSON.stringify(
    globalThis.__browserSqliteValidationResult,
    null,
    2,
  );
} catch (error) {
  globalThis.__browserSqliteValidationResult = {
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
  };
  resultElement.textContent = JSON.stringify(
    globalThis.__browserSqliteValidationResult,
    null,
    2,
  );
}

async function runRealBrowserValidation() {
  const dataSource = createBrowserSqliteDataSource();
  const progress = [];
  const startedAt = performance.now();
  let queryHeartbeat = null;
  let queryHeartbeatSafety = null;

  try {
    const initialization = await dataSource.initialize();
    requireCondition(initialization.ok, 'The real worker did not initialize.');
    requireCondition(
      initialization.capabilities.persistence === 'temporary',
      'The browser SQLite adapter did not report temporary storage.',
    );

    const unsubscribeProgress = dataSource.subscribeImportProgress((event) => {
      progress.push(event);
    });
    let heartbeatCount = 0;
    const heartbeat = setInterval(() => {
      heartbeatCount += 1;
    }, 0);
    const largeImportStartedAt = performance.now();
    const imported = await dataSource.importBrowserFiles({
      files: [createCsvFile(LARGE_ROW_COUNT, 'large-30000.csv')],
    });
    const largeImportDurationMs = performance.now() - largeImportStartedAt;
    clearInterval(heartbeat);
    unsubscribeProgress();

    requireCondition(imported.ok, 'The 30,000-row CSV import failed.');
    requireEqual(imported.successfulCount, 1, 'successful file count');
    requireEqual(imported.results[0]?.rowCount, LARGE_ROW_COUNT, 'imported row count');
    requireCondition(heartbeatCount > 0, 'The main browser thread did not stay responsive.');
    requireCondition(
      progress.some((event) => event.state === 'storing'),
      'The import did not report storage progress.',
    );
    requireCondition(
      progress.some((event) => event.state === 'completed' && event.ok),
      'The import did not report successful terminal progress.',
    );
    assertNoSourceRows(imported, 'import result');
    progress.forEach((event) => assertNoSourceRows(event, 'progress event'));

    const summary = await dataSource.getDatasetSummary();
    requireEqual(summary.datasets.length, 1, 'dataset count after import');
    requireEqual(summary.datasets[0].rowCount, LARGE_ROW_COUNT, 'summary row count');
    requireEqual(
      summary.datasets[0].importedFeatureCount,
      LARGE_ROW_COUNT,
      'derived point count',
    );
    requireEqual(summary.timeline?.yearMin, 1000, 'timeline minimum year');
    requireEqual(summary.timeline?.yearMax, 1999, 'timeline maximum year');
    assertNoSourceRows(summary, 'dataset summary');
    const datasetId = summary.datasets[0].id;

    const preview = await dataSource.getPreviewPage({
      datasetId,
      offset: 12_345,
      limit: 3,
    });
    requireEqual(preview.rows.length, 3, 'bounded preview row count');
    requireEqual(preview.totalRows, LARGE_ROW_COUNT, 'preview total row count');
    requireEqual(preview.rows[0]?.name, 'Row 12345', 'first preview row');
    requireEqual(preview.rows[2]?.name, 'Row 12347', 'last preview row');
    requireCondition(preview.hasMore, 'The preview should report more rows.');

    let queryHeartbeatCount = 0;
    queryHeartbeat = setInterval(() => {
      queryHeartbeatCount += 1;
    }, 0);
    // Ensure a failed assertion cannot leave the validation page with a live timer.
    queryHeartbeatSafety = setTimeout(() => {
      clearInterval(queryHeartbeat);
    }, 30_000);
    const exactStartedAt = performance.now();
    const exact = await dataSource.queryMapView({
      bounds: { north: 1.01, south: 0.99, east: 1.01, west: 0.99 },
      renderBudget: 100,
    });
    const exactDurationMs = performance.now() - exactStartedAt;
    requireCondition(exact.points.length > 0, 'The exact query returned no points.');
    requireCondition(!exact.stats.overBudget, 'The exact query grouped unexpectedly.');
    requireCondition(
      exact.points.every((point) => point.renderType === 'exact'),
      'The exact query returned a grouped item.',
    );
    assertNoSourceRows(exact, 'exact viewport');

    const denseStartedAt = performance.now();
    const denseQuery = {
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      renderBudget: 100,
    };
    const dense = await dataSource.queryMapView(denseQuery);
    const denseDurationMs = performance.now() - denseStartedAt;
    requireCondition(dense.stats.overBudget, 'The dense query did not group.');
    requireCondition(dense.points.length <= 100, 'The dense query exceeded its budget.');
    requireEqual(dense.stats.totalMatchingCount, LARGE_ROW_COUNT, 'dense match count');
    assertNoSourceRows(dense, 'dense viewport');
    const repeatedDense = await dataSource.queryMapView(denseQuery);
    requireEqual(
      JSON.stringify(repeatedDense.points),
      JSON.stringify(dense.points),
      'stable dense results',
    );

    const sparse = await dataSource.queryMapView({
      bounds: { north: 3.1, south: 0.9, east: 3.1, west: 0.9 },
      renderBudget: 100,
    });
    requireCondition(sparse.points.length > 0, 'The sparse query returned no points.');
    requireCondition(!sparse.stats.overBudget, 'The sparse query grouped unexpectedly.');
    const empty = await dataSource.queryMapView({
      bounds: { north: -70, south: -80, east: -10, west: -20 },
      renderBudget: 100,
    });
    requireEqual(empty.points.length, 0, 'empty viewport point count');

    const timelineStartedAt = performance.now();
    const timeline = await dataSource.queryMapView({
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      timeline: { timelineEnabled: true, startYear: 1500, endYear: 1500 },
      renderBudget: 100,
    });
    const timelineDurationMs = performance.now() - timelineStartedAt;
    requireEqual(timeline.stats.totalMatchingCount, 30, 'timeline match count');

    const details = await dataSource.getFeatureDetails({
      sourceRef: exact.points[0].sourceRef,
    });
    requireCondition(details.row?.name, 'Exact detail lookup returned no row.');
    requireEqual(details.latField, 'lat', 'detail latitude mapping');
    requireEqual(details.lonField, 'lon', 'detail longitude mapping');

    const groupedPoint = dense.points.find((point) => point.count > 30);
    requireCondition(groupedPoint?.groupRef, 'No pageable dense group was returned.');
    const firstGroupPage = await dataSource.getGroupRows({
      groupRef: groupedPoint.groupRef,
    });
    const secondGroupPage = await dataSource.getGroupRows({
      groupRef: groupedPoint.groupRef,
      offset: firstGroupPage.limit,
    });
    clearInterval(queryHeartbeat);
    clearTimeout(queryHeartbeatSafety);
    requireEqual(firstGroupPage.rows.length, 30, 'first group page size');
    requireCondition(secondGroupPage.rows.length > 0, 'The later group page was empty.');
    requireEqual(
      new Set([
        ...firstGroupPage.rows.map((row) => row.name),
        ...secondGroupPage.rows.map((row) => row.name),
      ]).size,
      firstGroupPage.rows.length + secondGroupPage.rows.length,
      'unique rows across group pages',
    );
    requireCondition(queryHeartbeatCount > 0, 'The main thread stalled during queries.');

    let cancelPromise = null;
    const cancellationProgress = [];
    const unsubscribeCancellation = dataSource.subscribeImportProgress((event) => {
      if (event.fileName !== 'cancel-120000.csv') return;
      cancellationProgress.push(event);
      if (!cancelPromise && event.state === 'storing') {
        cancelPromise = dataSource.cancelImport(event.importId);
      }
    });
    const canceledImport = await dataSource.importBrowserFiles({
      files: [createCsvFile(CANCEL_ROW_COUNT, 'cancel-120000.csv')],
    });
    unsubscribeCancellation();
    const cancellation = await cancelPromise;

    requireCondition(cancelPromise, 'Cancellation was never requested.');
    requireCondition(cancellation.canceled, 'The active import did not acknowledge cancellation.');
    requireCondition(canceledImport.canceled, 'The active import did not return a canceled result.');
    requireEqual(canceledImport.successfulCount, 0, 'canceled successful file count');
    requireCondition(
      cancellationProgress.some((event) => (
        event.state === 'completed' && event.ok === false
      )),
      'Cancellation did not emit terminal failed progress.',
    );

    const summaryAfterCancellation = await dataSource.getDatasetSummary();
    requireEqual(
      summaryAfterCancellation.datasets.length,
      1,
      'dataset count after canceled rollback',
    );
    requireEqual(
      summaryAfterCancellation.datasets[0].id,
      datasetId,
      'preserved committed dataset',
    );

    return {
      largeRowCount: LARGE_ROW_COUNT,
      storedRowCount: summary.datasets[0].rowCount,
      previewOffset: preview.offset,
      previewRows: preview.rows.length,
      progressEventCount: progress.length,
      heartbeatCount,
      queryHeartbeatCount,
      queryResults: {
        exact: exact.points.length,
        dense: dense.points.length,
        sparse: sparse.points.length,
        empty: empty.points.length,
        timeline: timeline.points.length,
        denseGroups: dense.points.length,
        groupTotalRows: firstGroupPage.totalRows,
        groupPagesRead: 2,
        detailFound: details.row != null,
      },
      canceledImportRolledBack: true,
      restartVerifiedEmpty: await verifyRestartIsEmpty(dataSource),
      timingsMs: {
        largeImport: Math.round(largeImportDurationMs),
        exactQuery: Math.round(exactDurationMs),
        denseQuery: Math.round(denseDurationMs),
        timelineQuery: Math.round(timelineDurationMs),
        total: Math.round(performance.now() - startedAt),
      },
    };
  } finally {
    clearInterval(queryHeartbeat);
    clearTimeout(queryHeartbeatSafety);
    dataSource.dispose();
  }
}

async function verifyRestartIsEmpty(previousDataSource) {
  previousDataSource.dispose();
  const restarted = createBrowserSqliteDataSource();
  try {
    const initialization = await restarted.initialize();
    requireCondition(initialization.ok, 'The restarted worker did not initialize.');
    const summary = await restarted.getDatasetSummary();
    requireEqual(summary.datasets.length, 0, 'restarted dataset count');
    return true;
  } finally {
    restarted.dispose();
  }
}

function createCsvFile(rowCount, name) {
  const lines = new Array(rowCount + 1);
  lines[0] = 'name,lat,lon,year';
  for (let index = 0; index < rowCount; index += 1) {
    lines[index + 1] = `Row ${index},${index % 80},${index % 170},${1000 + (index % 1000)}`;
  }
  return new File([lines.join('\n')], name, {
    type: 'text/csv',
    lastModified: 1_750_000_000_000,
  });
}

function assertNoSourceRows(value, label) {
  const forbiddenKeys = new Set(['rows', 'row', 'rowJson', 'sourceRows']);
  const pending = [value];
  const seen = new WeakSet();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      requireCondition(!forbiddenKeys.has(key), `${label} exposed source rows.`);
      if (child && typeof child === 'object') pending.push(child);
    }
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}.`);
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
