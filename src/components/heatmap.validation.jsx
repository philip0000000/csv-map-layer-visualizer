import React, { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import '../App.css';
import GeoMap from './GeoMap';
import { useMapViewQuery } from './useMapViewQuery';
import { useTimelinePlayback } from './useTimelinePlayback';
import { getCurrentHeatPoints } from './heatmap';

const element = document.getElementById('validation-root');
element.style.height = '100vh';
const root = createRoot(element);
const errors = [];
globalThis.addEventListener('error', (event) => errors.push(String(event.error ?? event.message)));
globalThis.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const point = { id: 'exact', lat: 59.3293, lon: 18.0686, renderType: 'exact', count: 1 };
const line = { id: 'line', coordinates: [[59.3, 18], [59.4, 18.2]], style: { color: '#5231a3', weight: 4 } };
const region = { id: 'region', coordinates: [[59.2, 17.8], [59.25, 17.8], [59.25, 17.9]], style: { color: '#5231a3' } };
let props = { points: [point], lines: [line], regions: [region] };

/** Exercise the real Leaflet canvas under StrictMode rather than mocking its lifecycle. */
function render(patch = {}) {
  props = { ...props, ...patch };
  flushSync(() => root.render(<StrictMode><GeoMap {...props} /></StrictMode>));
}

/** Wait briefly for React commits and Leaflet animation frames with a bounded timeout. */
async function waitFor(condition, message) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 5000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Check that a heat frame contains real colour pixels, not merely a mounted canvas. */
function hasHeat() {
  const canvas = element.querySelector('.leaflet-heatmap-layer');
  if (!canvas) return false;
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
  return false;
}

/** Validate heat toggles, weights, geometry isolation, redraws and final cleanup. */
async function run() {
  render();
  await waitFor(() => element.querySelector('.leaflet-marker-icon'), 'Default marker missing');
  if (element.querySelector('.leaflet-heatmap-layer')) throw new Error('Heatmap should default off');
  render({ heatmapEnabled: true });
  await waitFor(hasHeat, 'Heat canvas did not draw');
  if (!element.querySelector('.leaflet-marker-icon')) throw new Error('Markers should remain visible by default');
  render({ heatmapShowMarkers: false });
  if (element.querySelector('.leaflet-marker-icon')) throw new Error('Markers were not hidden');
  if (element.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive').length !== 2) {
    throw new Error('Line or region disappeared');
  }
  const pane = element.querySelector('.leaflet-pointHeatmap-pane');
  if (pane.style.pointerEvents !== 'none' || pane.style.zIndex !== '350') throw new Error('Heat pane intercepts geometry');
  if (element.querySelectorAll('.heatmapLegend').length !== 1) throw new Error('Legend missing or duplicated');
  render({ heatmapShowMarkers: true });
  await waitFor(() => element.querySelector('.leaflet-marker-icon'), 'Show markers failed');
  render({ clusterMarkersEnabled: true, clusterRadius: 0 });
  await waitFor(hasHeat, 'Clustering changed heat visibility');
  render({ points: [], heatRadius: 50 });
  await waitFor(() => !hasHeat(), 'Empty results retained stale heat');
  const dense = Array.from({ length: 1000 }, (_, index) => ({
    ...point, id: `summary-${index}`, renderType: 'grouped', count: 30,
    lat: point.lat + (index % 40 - 20) * 0.005,
    lon: point.lon + (Math.floor(index / 40) - 12) * 0.01,
  }));
  render({ points: dense, heatmapShowMarkers: false, heatRadius: 25 });
  await waitFor(hasHeat, 'Dense summary results did not draw');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const canvas = element.querySelector('.leaflet-heatmap-layer');
  const centre = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
  if (centre[3] < 200) throw new Error('Dense count weights did not produce a strong hotspot');
  // Capture this deterministic dense view before continuing lifecycle checks.
  globalThis.__heatmapVisualReady = true;
  await waitFor(() => globalThis.__heatmapVisualCaptured === true, 'Screenshot was not captured');
  render({ heatmapEnabled: false });
  await waitFor(() => !element.querySelector('.leaflet-heatmap-layer'), 'Canvas survived toggle off');
  if (element.querySelector('.heatmapLegend')) throw new Error('Legend survived toggle off');
  render({ points: [point], heatmapEnabled: true });
  await waitFor(hasHeat, 'Heat did not survive re-enable');
  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (errors.length) throw new Error(errors.join('\n'));
  return { status: 'passed', checks: 'Default, heat pixels, markers, geometry, empty results, summaries, StrictMode cleanup' };
}

const playbackFrames = [];
const playbackQueries = [];
let playbackControls;
let playbackViewport;
let queryDelay = 30;
let activeQueries = 0;
let maxActiveQueries = 0;
let emptyDuringPlayback = false;
const densePoints = Array.from({ length: 1000 }, (_, index) => ({
  ...point, id: `dense-${index}`, renderType: 'grouped', count: 30,
  lat: point.lat + (index % 40 - 20) * 0.005,
  lon: point.lon + (Math.floor(index / 40) - 12) * 0.01,
}));
const playbackDataSource = {
  /** Model a slow backend while preserving the App's filtered query contract. */
  async queryMapView(query) {
    const frame = query.timeline.endYear;
    playbackQueries.push({ frame, zoom: query.zoom, bounds: query.bounds });
    maxActiveQueries = Math.max(maxActiveQueries, ++activeQueries);
    await new Promise((resolve) => setTimeout(resolve, queryDelay));
    activeQueries--;
    return {
      points: query.datasetIds.length ? densePoints.map((item) => ({
        ...item, lon: item.lon + frame * 0.001,
      })) : [],
      frame,
    };
  },
};

/** Use the actual playback and query hooks to test their App integration together. */
export function PlaybackHarness() {
  const [timeline, setTimeline] = useState({ timelineEnabled: true,
    yearMin: 0, yearMax: 14, startYear: 0, endYear: 0,
    playback: { isPlaying: false, stepYears: 1, intervalMs: 100, moveStartWithEnd: false } });
  const [enabled, setEnabled] = useState(true);
  const [viewport, setViewport] = useState(null);
  const [mapState, setMapState] = useState({ status: 'idle', result: null, error: null });
  const datasetIds = useMemo(() => enabled ? ['dense'] : [], [enabled]);
  const contextKey = JSON.stringify([datasetIds, 0]);
  const query = useMemo(() => ({ bounds: viewport?.bounds, zoom: viewport?.zoom,
    timeline: { ...timeline, playback: undefined }, datasetIds, renderBudget: 1000 }),
  [viewport, timeline, datasetIds]);
  const api = useTimelinePlayback({ timelineState: timeline,
    onTimelinePatch: (patch) => setTimeline((current) => ({ ...current, ...patch })) });
  useMapViewQuery({ dataSource: playbackDataSource, query, contextKey,
    playback: timeline.playback.isPlaying, ready: !!viewport, onStateChange: setMapState });
  const heatPoints = getCurrentHeatPoints(mapState, contextKey, datasetIds);

  useEffect(() => {
    playbackControls = { ...api, setEnabled, timeline, mapState,
      rewind: () => setTimeline((current) => ({ ...current, endYear: 0 })) };
    playbackViewport = viewport;
    if (mapState.result && playbackFrames.at(-1) !== mapState.result.frame) {
      playbackFrames.push(mapState.result.frame);
    }
    if (timeline.playback.isPlaying && enabled && mapState.result && heatPoints.length === 0) {
      emptyDuringPlayback = true;
    }
  }, [api, timeline, mapState, viewport, enabled, heatPoints.length]);

  return <GeoMap points={mapState.result?.points ?? []} heatPoints={heatPoints}
    heatmapEnabled heatmapShowMarkers={false} onViewportChange={setViewport}
    onNavigationReady={(navigate) => { if (navigate) playbackNavigate = navigate; }} />;
}

let playbackNavigate;

/** Require progressive frames at 100 ms ticks, including queries slower than one tick. */
async function runPlaybackRegression() {
  const playbackRoot = createRoot(element);
  try {
    flushSync(() => playbackRoot.render(<StrictMode><PlaybackHarness /></StrictMode>));
    await waitFor(() => playbackControls?.mapState.result?.frame === 0 && hasHeat(), 'Initial playback heat missing');
    for (const delay of [30, 160]) {
      queryDelay = delay;
      playbackControls.rewind();
      await waitFor(() => playbackControls.timeline.endYear === 0, 'Timeline did not rewind');
      await waitFor(() => playbackControls.mapState.result.frame === 0, 'Rewound frame was not queried');
      const before = playbackFrames.length;
      playbackControls.startPlayback();
      await waitFor(() => playbackControls.timeline.endYear >= 8, 'Fast playback did not advance');
      const during = playbackFrames.slice(before);
      if (during.filter((frame) => frame > 0).length < 2) throw new Error(`Playback starved with ${delay} ms queries`);
      if (emptyDuringPlayback || !hasHeat()) throw new Error('Heat went blank while playback refreshed');
      await waitFor(() => playbackControls.timeline.endYear === 14
        && playbackControls.mapState.result.frame === 14, 'Final playback frame missing');
    }
    if (maxActiveQueries !== 1) throw new Error('Playback queries overlapped');

    // Exercise dense zoom/pan through real Leaflet controls and its navigation API.
    const zoomBefore = playbackViewport.zoom;
    element.querySelector('.leaflet-control-zoom-in').click();
    await waitFor(() => playbackViewport.zoom > zoomBefore, 'Dense zoom did not complete');
    await waitFor(() => playbackQueries.at(-1)?.zoom === playbackViewport.zoom, 'Zoom viewport was not queried');
    const westBefore = playbackViewport.bounds.west;
    playbackNavigate({ point: [point.lat, point.lon + 0.3] }, 0);
    await waitFor(() => playbackViewport.bounds.west !== westBefore, 'Dense pan did not complete');
    await waitFor(() => playbackQueries.at(-1)?.bounds.west === playbackViewport.bounds.west, 'Pan viewport was not queried');
    await waitFor(hasHeat, 'Dense zoom/pan lost the heat layer');

    // Hide during a slow in-flight frame; its eventual completion cannot restore heat.
    playbackControls.rewind();
    await waitFor(() => playbackControls.timeline.endYear === 0, 'Visibility test did not rewind');
    playbackControls.startPlayback();
    await waitFor(() => activeQueries > 0, 'Visibility test did not start a query');
    playbackControls.setEnabled(false);
    await waitFor(() => !hasHeat(), 'Dataset hide retained heat');
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (hasHeat()) throw new Error('In-flight frame restored hidden heat');
    playbackControls.stopPlayback();
    if (errors.length) throw new Error(errors.join('\n'));
    return { status: 'passed', checks: 'Canvas lifecycle; actual query/playback hooks at 100 ms ticks with 30/160 ms queries; dense zoom/pan; in-flight visibility invalidation' };
  } finally {
    playbackRoot.unmount();
  }
}

run().then(runPlaybackRegression).then((result) => { globalThis.__heatmapValidationResult = result; }).catch((error) => {
  globalThis.__heatmapValidationResult = { status: 'failed', message: error.message };
});
