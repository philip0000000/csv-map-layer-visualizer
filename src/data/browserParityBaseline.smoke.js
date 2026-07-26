import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Load browser modules through the same transform and resolution path as Vite.
const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const { createInMemoryDataSource } = await vite.ssrLoadModule(
    '/src/data/inMemoryDataSource.js',
  );
  const { autoDetectTimelineFields, tryParseDayOfYear } =
    await vite.ssrLoadModule('/src/components/timeline.js');

  const rows = [
    { featureType: 'point', lat: '1', lon: '1', year: '2020', dayOfYear: '10', name: 'Winter' },
    { featureType: 'point', lat: '2', lon: '2', year: '2020', dayOfYear: '200', name: 'Summer' },
    { featureType: 'line', featureId: 'route', order: '2', lat: '4', lon: '4', year: '2020', dayOfYear: '200', color: '#123456', weight: '5', arrow: 'end' },
    { featureType: 'line', featureId: 'route', order: '1', lat: '3', lon: '3', year: '2020', dayOfYear: '200' },
    { featureType: 'region', featureId: 'area', part: 'north', order: '1', lat: '5', lon: '5', year: '2020', dayOfYear: '200', fillColor: '#abcdef' },
    { featureType: 'region', featureId: 'area', part: 'north', order: '2', lat: '6', lon: '6', year: '2020', dayOfYear: '200' },
    { featureType: 'region', featureId: 'area', part: 'north', order: '3', lat: '5', lon: '7', year: '2020', dayOfYear: '200' },
  ];
  const headers = [
    'featureType', 'featureId', 'part', 'order', 'lat', 'lon', 'year',
    'dayOfYear', 'name', 'color', 'weight', 'fillColor', 'arrow',
  ];
  const files = [
    {
      id: 'enabled', name: 'baseline.csv', enabled: true, headers, rows,
      totalRows: rows.length, latField: 'lat', lonField: 'lon',
      parseErrors: ['representative warning'],
    },
    {
      id: 'disabled', name: 'hidden.csv', enabled: false, headers,
      rows: [{ featureType: 'point', lat: '8', lon: '8', year: '2020' }],
      totalRows: 1, latField: 'lat', lonField: 'lon', parseErrors: [],
    },
  ];

  const dataSource = createInMemoryDataSource({ files });
  const unfiltered = dataSource.queryMapView();
  assert.deepEqual(
    [unfiltered.points.length, unfiltered.lines.length, unfiltered.regions.length],
    [2, 1, 1],
  );
  assert.deepEqual(unfiltered.lines[0].coordinates, [[3, 3], [4, 4]]);
  assert.deepEqual(unfiltered.lines[0].style, { color: '#123456', weight: 5 });
  assert.equal(unfiltered.lines[0].arrow, 'end');
  assert.equal(unfiltered.regions[0].part, 'north');
  assert.deepEqual(
    unfiltered.regions[0].coordinates.at(-1),
    unfiltered.regions[0].coordinates[0],
  );
  assert.equal(unfiltered.regions[0].style.fillColor, '#abcdef');

  const point = unfiltered.points.find((item) => item.sourceRef?.rowIndex === 0);
  assert.deepEqual(point.sourceRef, { datasetId: 'enabled', rowIndex: 0 });
  assert.equal(Object.hasOwn(point, 'row'), false);
  assert.deepEqual(
    dataSource.getFeatureDetails({ featureId: point.id, sourceRef: point.sourceRef }),
    { featureId: point.id, row: rows[0], latField: 'lat', lonField: 'lon' },
  );
  assert.deepEqual(
    dataSource.getGroupRows({ datasetId: 'enabled', offset: 1, limit: 2 }),
    {
      rows: rows.slice(1, 3),
      offset: 1,
      limit: 2,
      totalRows: rows.length,
      hasMore: true,
    },
  );

  const summary = dataSource.getDatasetSummary();
  assert.equal(summary.datasets.length, 2);
  assert.deepEqual(summary.datasets[0].parseErrors, ['representative warning']);
  assert.deepEqual(summary.timeline, { yearMin: 2020, yearMax: 2020 });

  const detected = autoDetectTimelineFields(headers);
  assert.deepEqual(detected, {
    yearField: 'year', dateField: null, dayOfYearField: 'dayOfYear',
  });
  assert.equal(tryParseDayOfYear(rows[0], detected), 10);

  // Day state is present but does not affect current map results.
  const excludedDays = dataSource.queryMapView({ timeline: {
    timelineEnabled: true, startYear: 2020, endYear: 2020,
    dayFilterEnabled: true, startDay: 50, endDay: 100,
  } });
  assert.deepEqual(
    [excludedDays.points.length, excludedDays.lines.length, excludedDays.regions.length],
    [2, 1, 1],
  );
  assert.equal(excludedDays.stats.skippedByTimeline, 0);

  // Year state does affect points, lines, and regions.
  const excludedYear = dataSource.queryMapView({ timeline: {
    timelineEnabled: true, startYear: 2021, endYear: 2021,
    dayFilterEnabled: false, startDay: 1, endDay: 365,
  } });
  assert.deepEqual(
    [excludedYear.points.length, excludedYear.lines.length, excludedYear.regions.length],
    [0, 0, 0],
  );
  assert.equal(excludedYear.stats.skippedByTimeline, 4);

  console.log('Browser parity baseline smoke test passed.');
} finally {
  await vite.close();
}
