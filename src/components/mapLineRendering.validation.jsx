import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import '../index.css';
import GeoMap from './GeoMap';

const rootElement = document.getElementById('validation-root');
const root = createRoot(rootElement);
const renderingErrors = [];

globalThis.addEventListener('error', (event) => {
  renderingErrors.push(event.error ?? event.message);
});
globalThis.addEventListener('unhandledrejection', (event) => {
  renderingErrors.push(event.reason);
});

runValidation().then(() => {
  globalThis.__mapLineRenderingValidationResult = { status: 'passed' };
}).catch((error) => {
  globalThis.__mapLineRenderingValidationResult = {
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
  if (!condition) throw new Error(message || 'Map line rendering failed.');
}
