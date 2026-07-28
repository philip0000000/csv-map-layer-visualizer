import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import {
  findMarkersNearClickedMarker,
  MARKER_PROXIMITY_RADIUS_PIXELS,
} from './markerProximitySelection.js';
import { getInitialMapToolsState } from './useMapToolsState.js';

assert.equal(getInitialMapToolsState().clusterMarkersEnabled, false);
assert.equal(MARKER_PROXIMITY_RADIUS_PIXELS, 18);

const clicked = { id: 'clicked', lat: 1, lon: 1 };
const equallyNearFirst = { id: 'equally-near-first', lat: 2, lon: 2 };
const equallyNearSecond = { id: 'equally-near-second', lat: 3, lon: 3 };
const boundary = { id: 'boundary', lat: 4, lon: 4 };
const outsideCircle = { id: 'outside-circle', lat: 5, lon: 5 };
const filteredOut = { id: 'filtered-out', lat: 6, lon: 6 };
const projectedPoints = new Map([
  [clicked, { x: 100, y: 100 }],
  [equallyNearFirst, { x: 106, y: 108 }],
  [equallyNearSecond, { x: 94, y: 92 }],
  [boundary, { x: 118, y: 100 }],
  [outsideCircle, { x: 113, y: 113 }],
  [filteredOut, { x: 101, y: 101 }],
]);

const visibleMarkers = [
  equallyNearFirst,
  boundary,
  clicked,
  outsideCircle,
  equallyNearSecond,
];
const nearby = findMarkersNearClickedMarker(
  visibleMarkers,
  clicked,
  (marker) => projectedPoints.get(marker),
);

assert.deepEqual(
  nearby.map((marker) => marker.id),
  ['clicked', 'equally-near-first', 'equally-near-second', 'boundary'],
);
assert.equal(nearby.includes(outsideCircle), false);
assert.equal(nearby.includes(filteredOut), false);
assert.deepEqual(
  findMarkersNearClickedMarker(
    [clicked],
    clicked,
    (marker) => projectedPoints.get(marker),
  ),
  [clicked],
);

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});
try {
  const { MarkerDetailsPanel } = await vite.ssrLoadModule(
    '/src/components/MarkerDetailsPanel.jsx',
  );
  const markup = renderToStaticMarkup(React.createElement(
    MarkerDetailsPanel,
    {
      marker: clicked,
      markers: [clicked, equallyNearFirst],
      leftOffset: 420,
      isCollapsed: false,
      onToggleCollapse() {},
      onClose() {},
    },
  ));

  assert.match(markup, /Markers near this location/);
  assert.match(markup, /Marker 1 \(selected\)/);
  assert.match(markup, /Marker 2/);

  const singleMarkup = renderToStaticMarkup(React.createElement(
    MarkerDetailsPanel,
    {
      marker: clicked,
      markers: [clicked],
      leftOffset: 420,
      isCollapsed: false,
      onToggleCollapse() {},
      onClose() {},
    },
  ));

  assert.match(singleMarkup, />Point</);
  assert.doesNotMatch(singleMarkup, /Markers near this location/);
} finally {
  await vite.close();
}

console.log('Marker proximity-selection smoke test passed.');
