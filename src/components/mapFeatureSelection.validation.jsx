import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import '../index.css';
import '../App.css';
import GeoMap from './GeoMap';
import { MarkerDetailsPanel } from './MarkerDetailsPanel';
import { useFeatureSelection } from './useFeatureSelection';

const rootElement = document.getElementById('validation-root');
// Give the standalone fixture real map bounds so arrow visibility and drag projection are meaningful.
rootElement.style.height = '100vh';
const root = createRoot(rootElement);
const renderingErrors = [];

globalThis.addEventListener('error', (event) => {
  renderingErrors.push(event.error ?? event.message);
});
globalThis.addEventListener('unhandledrejection', (event) => {
  renderingErrors.push(event.reason);
});

runValidation().then(runSelectionValidation).then(() => {
  globalThis.__mapFeatureSelectionValidationResult = { status: 'passed' };
}).catch((error) => {
  globalThis.__mapFeatureSelectionValidationResult = {
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
  };
});

/** Render a line through GeoMap and verify that Leaflet creates its vector layer. */
async function runValidation() {
  root.render(
    <GeoMap
      points={[{
        id: 'validation-point',
        lat: 59.3293,
        lon: 18.0686,
        marker: '📍',
        row: { name: 'Validation point' },
      }]}
      lines={[{
        id: 'validation-line',
        coordinates: [
          [59.3293, 18.0686],
          [59.4, 18.2],
        ],
        style: { color: '#5231A3', weight: 4 },
        arrow: 'none',
        row: { name: 'Validation line' },
      }]}
    />,
  );

  await waitFor(
    () => rootElement.querySelector('.leaflet-container'),
    'the Leaflet map to mount',
  );
  await waitFor(
    () => rootElement.querySelector('.leaflet-overlay-pane path.leaflet-interactive'),
    'the CSV line path to render',
  );
  await waitFor(
    () => rootElement.querySelector('.leaflet-marker-pane .leaflet-marker-icon'),
    'the CSV point marker to render beside the line',
  );

  // Give asynchronous React and Leaflet work one more frame to report rendering errors.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(renderingErrors.length === 0, formatRenderingErrors(renderingErrors));
}

/** Wait for browser rendering to satisfy a validation condition. */
async function waitFor(predicate, description, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Convert captured browser errors into a concise validation failure. */
function formatRenderingErrors(errors) {
  return errors.map((error) => (
    error instanceof Error ? error.message : String(error)
  )).join('; ');
}

/** Throw a validation error when an expected renderer condition is false. */
function assert(condition, message) {
  if (!condition) throw new Error(message || 'Map feature selection failed.');
}


const validationLine = {
  id: 'test:line', featureId: 'line', coordinates: [[59, 17], [60, 20]],
  style: { color: '#5231a3', weight: 4 }, arrow: 'both',
  sourceRef: { datasetId: 'test', rowIndex: 0 },
  timelineExtent: { startYear: 1000, endYear: 1000 },
};
const validationRegions = ['main', 'island'].map((part, index) => ({
  id: `test:zone:${part}`, featureId: 'zone', part,
  coordinates: [[58 + index, 15], [58 + index, 16], [58.5 + index, 16]],
  style: { color: '#b21c55', weight: 3, fillColor: '#33aa66', fillOpacity: 0.2 },
  sourceRef: { datasetId: 'test', rowIndex: 1 },
  timelineExtent: { startYear: 1000, endYear: 1000 },
}));
let selectionDriver;
let heldDetail = null;
let nextDetailOutcome = null;
let failNextGroup = false;
let holdNextLine = false;
let loadedZoneCount = 0;
let savedZone = null;
const validationGroupRows = [
  { name: 'Group row 1000', year: 1000 },
  { name: 'Group row 1100', year: 1100 },
];
const selectionDataSource = {
  getGroupRows({ groupRef, offset = 0, limit = 30 }) {
    if (failNextGroup) {
      failNextGroup = false;
      return Promise.reject(new Error('Fixture group refresh failure'));
    }
    const rows = validationGroupRows.filter((row) => !groupRef.timeline
      || (row.year >= groupRef.timeline.startYear && row.year <= groupRef.timeline.endYear));
    return Promise.resolve({ rows: rows.slice(offset, offset + limit), totalRows: rows.length, offset, limit });
  },
  getFeatureDetails({ sourceRef }) {
    const outcome = nextDetailOutcome;
    nextDetailOutcome = null;
    if (outcome === 'error') return Promise.reject(new Error('Fixture detail failure'));
    if (outcome === 'empty') return Promise.resolve({ row: null });
    const details = { row: { name: sourceRef.rowIndex === 0 ? 'Selected line' : 'Selected zone', year: 1000 } };
    if (sourceRef.rowIndex === 0 && holdNextLine) {
      holdNextLine = false;
      return new Promise((resolve) => { heldDetail = () => resolve(details); });
    }
    return Promise.resolve(details);
  },
};

/** Load all edit parts, including one deliberately absent from the displayed map. */
async function loadValidationZone() {
  loadedZoneCount += 1;
  return {
    datasetId: 'test', featureId: 'zone',
    parts: [...validationRegions, { ...validationRegions[0], part: 'hidden' }],
  };
}

/** Capture a completed drag without writing any dataset or file. */
async function saveValidationZone(request) {
  savedZone = request;
  return { ...request, parts: request.parts.map((part) => ({ ...part, style: validationRegions[0].style })) };
}

/** Exercise the real shared selection hook, Leaflet layers, editor, and panel together. */
export function SelectionValidationScene() {
  const [enabled, setEnabled] = useState(true);
  const [timeline, setTimeline] = useState({ timelineEnabled: false });
  const [editing, setEditing] = useState(false);
  const [inView, setInView] = useState(true);
  const selection = useFeatureSelection({
    dataSource: selectionDataSource,
    datasets: [{ id: 'test', enabled, detectedFields: { yearField: 'year' } }],
    timeline,
  });
  useEffect(() => {
    selectionDriver = { ...selection, setEnabled, setTimeline, setEditing, setInView };
  }, [selection]);
  return (
    <>
      <GeoMap
        lines={inView && enabled ? [validationLine] : []}
        regions={inView && enabled ? validationRegions : []}
        selectedFeature={selection.selectedFeature}
        onFeatureSelect={selection.selectFeature}
        zoneEditingEnabled={editing}
        getLogicalZone={loadValidationZone}
        updateLogicalZone={saveValidationZone}
        enabledDatasetIds={validationDatasetIds}
      />
      <MarkerDetailsPanel
        feature={selection.selectedFeature}
        getFeatureDetails={selection.getFeatureDetails}
        getGroupRows={selection.getGroupRows}
        nearbyMarkers={selection.nearbyMarkers}
        refreshError={selection.groupRefreshError}
        leftOffset={0}
        isCollapsed={selection.isCollapsed}
        onToggleCollapse={selection.toggleCollapse}
        onClose={selection.close}
      />
    </>
  );
}
const validationDatasetIds = ['test'];

/** Verify interactions and races in a browser renderer rather than only static markup. */
async function runSelectionValidation() {
  root.render(<SelectionValidationScene />);
  await waitFor(() => selectionDriver && linePath(), 'selection scene');
  click(linePath());
  await waitFor(() => panel()?.textContent.includes('Selected line'), 'line details');
  assert(!document.querySelector('.leaflet-popup'), 'Line selection must not open a popup.');
  assert(highlights().length === 3, 'Selected line must have a halo and original stroke.');
  assert(linePath().getAttribute('stroke') === '#5231a3', 'Original line color changed.');
  assert(document.querySelectorAll('.leaflet-featureArrows-pane path').length === 2, 'Line arrows disappeared.');
  assert(highlights().every((path) => !path.classList.contains('leaflet-interactive')), 'Highlights capture clicks.');

  click(panel().querySelector('[aria-label="Collapse feature details"]'));
  await waitFor(() => panel().querySelector('.markerDetailsPanelContent').hidden, 'panel collapse');
  assert(highlights().length === 3, 'Collapse cleared the highlight.');
  click(linePath());
  await waitFor(() => !panel().querySelector('.markerDetailsPanelContent').hidden, 'selection expands panel');
  click(document.querySelector('.leaflet-container'));
  assert(!!panel(), 'Empty map click cleared selection.');
  click(panel().querySelector('[aria-label="Close feature details"]'));
  await waitFor(() => !panel() && highlights().length === 0, 'close clears selection');

  holdNextLine = true;
  click(linePath());
  await waitFor(() => heldDetail, 'deferred line request');
  click(zonePath());
  await waitFor(() => panel()?.textContent.includes('Selected zone'), 'zone replaces line');
  heldDetail();
  await nextFrame();
  assert(panel().textContent.includes('Selected zone'), 'Old line response replaced zone details.');
  assert(highlights().length === 6, 'All visible parts must share the zone highlight.');
  assert(!panel().textContent.includes('lat:'), 'Zone inherited a point coordinate heading.');

  selectionDriver.setEditing(true);
  await waitFor(() => loadedZoneCount > 0, 'logical zone editor load');
  await nextFrame();
  assert(document.querySelectorAll('path.leaflet-interactive[stroke="#b21c55"]').length === 2,
    'Editor revealed a hidden part or replaced the original zone border.');
  assert(highlights().length === 6, 'Editor highlighted a hidden part.');
  const path = zonePath();
  const previousShape = path.getAttribute('d');
  const bounds = path.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  path.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: x, clientY: y, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 15, clientY: y + 10, bubbles: true }));
  await waitFor(() => zonePath().getAttribute('d') !== previousShape, 'live zone preview');
  assert(highlights()[0].getAttribute('d') === zonePath().getAttribute('d'), 'Halo did not follow live preview.');
  document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: x + 15, clientY: y + 10, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
  await waitFor(() => savedZone, 'one completed zone save');
  assert(savedZone.parts.length === 3, 'Editing must still transform the full logical zone.');
  await nextFrame();
  const translatedShape = zonePath().getAttribute('d');
  const translatedSave = savedZone;
  const rotationBounds = zonePath().getBoundingClientRect();
  const rotateX = rotationBounds.right;
  const rotateY = rotationBounds.top;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  zonePath().dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: rotateX, clientY: rotateY, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: rotateX + 20, clientY: rotateY + 20, bubbles: true }));
  await waitFor(() => zonePath().getAttribute('d') !== translatedShape, 'live zone rotation');
  assert(highlights()[0].getAttribute('d') === zonePath().getAttribute('d'), 'Halo did not follow rotation.');
  document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: rotateX + 20, clientY: rotateY + 20, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
  await waitFor(() => savedZone !== translatedSave, 'completed rotation save');
  selectionDriver.close();
  await waitFor(() => !panel() && highlights().length === 0, 'close clears editor highlight');

  click(zonePath());
  await waitFor(() => panel()?.textContent.includes('Selected zone'), 'zone reselection');
  selectionDriver.setEnabled(false);
  await waitFor(() => !panel(), 'dataset hiding clears selection');
  selectionDriver.setEnabled(true);
  selectionDriver.setEditing(false);
  await waitFor(() => linePath(), 'dataset restored');
  click(linePath());
  await waitFor(() => panel()?.textContent.includes('Selected line'), 'line reselection');
  selectionDriver.setInView(false);
  await nextFrame();
  assert(!!panel(), 'Viewport absence cleared selection.');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1000, endYear: 1100 });
  await nextFrame();
  assert(!!panel(), 'Inclusive timeline boundary cleared a matching selection.');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1100, endYear: 1200 });
  await waitFor(() => !panel(), 'timeline exclusion clears offscreen selection');
  selectionDriver.setTimeline({ timelineEnabled: false });
  await nextFrame();
  assert(!panel(), 'Changing filters back revived a cleared selection.');

  // Detail outcomes must not decide whether the feature matches the active SQL timeline bounds.
  selectionDriver.setInView(true);
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1000, endYear: 1100 });
  await nextFrame();
  for (const outcome of ['empty', 'error']) {
    nextDetailOutcome = outcome;
    click(linePath());
    const message = outcome === 'empty' ? 'No details found.' : 'Could not load details.';
    await waitFor(() => panel()?.textContent.includes(message), `${outcome} detail state`);
    assert(highlights().length === 3, 'Detail failure cleared a matching selection.');
    selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1050, endYear: 1100 });
    await waitFor(() => !panel(), `timeline exclusion despite ${outcome} details`);
    selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1000, endYear: 1100 });
    await nextFrame();
  }

  const nearby = [1000, 1100].map((year, index) => ({
    id: `nearby:${index}`, selectionKind: 'point', lat: 59, lon: 18,
    sourceRef: { datasetId: 'test', rowIndex: index },
    timelineExtent: { startYear: year, endYear: year },
  }));
  selectionDriver.selectFeature(nearby[0], nearby);
  await waitFor(() => selectionDriver.nearbyMarkers.length === 2, 'nearby selection');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 900, endYear: 1200 });
  await nextFrame();
  assert(selectionDriver.nearbyMarkers.length === 2, 'Matching nearby list disappeared.');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 900, endYear: 1050 });
  await nextFrame();
  assert(selectionDriver.selectedFeature && selectionDriver.nearbyMarkers.length === 1,
    'Nearby filtering discarded the matching selected point.');

  selectionDriver.setTimeline({ timelineEnabled: false });
  await nextFrame();
  const group = {
    id: 'grid:0:0', renderType: 'grouped', selectionKind: 'point', lat: 59, lon: 18, count: 2,
    groupRef: { groupId: 'grid:0:0', datasetIds: ['test'], timeline: null,
      bounds: { north: 60, south: 58, east: 20, west: 16 },
      grid: { cellLat: 0, cellLon: 0, cellHeight: 2, cellWidth: 4 }, sortOrder: 'dataset-source-row' },
  };
  selectionDriver.selectFeature(group);
  await waitFor(() => panel()?.textContent.includes('Loaded 2 of 2'), 'initial group page');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 900, endYear: 1200 });
  await waitFor(() => selectionDriver.selectedFeature?.groupRef.timeline?.startYear === 900,
    'group confirms matching filter');
  assert(selectionDriver.selectedFeature.count === 2, 'Matching group was cleared.');
  failNextGroup = true;
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 950, endYear: 1150 });
  await waitFor(() => panel()?.textContent.includes('Could not refresh grouped markers'), 'group refresh error');
  assert(selectionDriver.selectedFeature.count === 2, 'Failed refresh cleared the previous group.');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 900, endYear: 1200 });
  await nextFrame();
  assert(!panel().textContent.includes('Could not refresh grouped markers'), 'Stale error remained on confirmed filters.');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1000, endYear: 1050 });
  await waitFor(() => selectionDriver.selectedFeature?.count === 1, 'group count refresh');
  await waitFor(() => panel()?.textContent.includes('Loaded 1 of 1'), 'group first page refresh');
  assert(selectionDriver.selectedFeature.groupRef.bounds === group.groupRef.bounds,
    'Timeline refresh changed the captured group cell.');
  selectionDriver.setTimeline({ timelineEnabled: true, startYear: 1300, endYear: 1400 });
  await waitFor(() => !panel(), 'empty group clears selection');

  assert(renderingErrors.length === 0, formatRenderingErrors(renderingErrors));
}

/** Locate source paths separately from non-interactive halo copies. */
function linePath() { return document.querySelector('path.leaflet-interactive[stroke="#5231a3"]'); }
function zonePath() { return document.querySelector('path.leaflet-interactive[stroke="#b21c55"]'); }
function highlights() { return [...document.querySelectorAll('.leaflet-featureSelection-pane path')]; }
function panel() { return document.querySelector('.markerDetailsPanel'); }
function click(element) { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
