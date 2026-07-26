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
    requireCondition(
      initialization.capabilities.lines && initialization.capabilities.regions,
      'The browser SQLite adapter did not report geometry parity.',
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

    const geometryImport = await dataSource.importBrowserFiles({
      files: [createGeometryCsvFile()],
    });
    requireCondition(geometryImport.ok, 'The geometry CSV import failed.');
    requireEqual(
      geometryImport.results[0]?.importedFeatureCount,
      3,
      'geometry derived feature count',
    );
    const geometryDatasetId = geometryImport.results[0]?.datasetId;
    const geometry = await dataSource.queryMapView({
      bounds: { north: 0.5, south: -0.5, east: 0.5, west: -0.5 },
      datasetIds: [geometryDatasetId],
      renderBudget: 10,
    });
    requireEqual(geometry.lines.length, 1, 'real-worker line count');
    requireEqual(geometry.regions.length, 1, 'real-worker crossing region count');
    requireEqual(geometry.lines[0].arrow, 'end', 'real-worker line arrow');
    requireEqual(
      geometry.regions[0].coordinates.length,
      4,
      'real-worker closed region coordinate count',
    );
    assertNoSourceRows(geometry, 'geometry viewport');

    const geometryTimeline = await dataSource.queryMapView({
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      datasetIds: [geometryDatasetId],
      timeline: { timelineEnabled: true, startYear: 2001, endYear: 2001 },
      renderBudget: 10,
    });
    requireEqual(geometryTimeline.lines.length, 1, 'timeline line count');
    requireEqual(geometryTimeline.regions.length, 2, 'timeline region count');

    const geometryDetails = await dataSource.getFeatureDetails({
      featureId: geometryTimeline.regions[1].id,
      sourceRef: geometryTimeline.regions[1].sourceRef,
    });
    requireEqual(
      geometryDetails.row?.name,
      'Region detail',
      'multipart region detail source',
    );

    const limitedGeometry = await dataSource.queryMapView({
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      datasetIds: [geometryDatasetId],
      renderBudget: 1,
    });
    requireCondition(
      limitedGeometry.stats.geometryOverLimit,
      'The real-worker geometry query did not enforce its limit.',
    );
    requireEqual(
      limitedGeometry.lines.length + limitedGeometry.regions.length,
      1,
      'limited real-worker geometry count',
    );

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
      2,
      'dataset count after canceled rollback',
    );
    requireCondition(
      summaryAfterCancellation.datasets.some((dataset) => dataset.id === datasetId),
      'The committed point dataset was not preserved.',
    );
    requireCondition(
      summaryAfterCancellation.datasets.some(
        (dataset) => dataset.id === geometryDatasetId,
      ),
      'The committed geometry dataset was not preserved.',
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
        lines: geometry.lines.length,
        regions: geometryTimeline.regions.length,
        geometryDetailFound: geometryDetails.row != null,
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

function createGeometryCsvFile() {
  const csv = [
    'name,featureType,featureId,part,order,lat,lon,year,color,weight,fillColor,arrow',
    'Line end,line,route,,2,0,10,2002,#123456,5,,end',
    'Line detail,line,route,,1,0,-10,2001,,,,',
    'Region detail,region,area,south,2,-5,5,2001,,,#abcdef,',
    'Region south first,region,area,south,1,-5,-5,2020,,,,',
    'Region south top,region,area,south,3,5,0,,,,,',
    'Region north first,region,area,north,1,10,10,,,,,',
    'Region north second,region,area,north,2,11,10,,,,,',
    'Region north third,region,area,north,3,10,11,,,,,',
  ].join('\n');
  return new File([csv], 'geometry.csv', {
    type: 'text/csv',
    lastModified: 1_750_000_000_001,
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
