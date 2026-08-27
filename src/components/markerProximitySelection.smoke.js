import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import {
  findMarkersNearClickedMarker,
  groupMarkersByProximity,
  MARKER_PROXIMITY_RADIUS_PIXELS,
} from './markerProximitySelection.js';
import { getInitialMapToolsState } from './useMapToolsState.js';
import {
  getGroupedMarkerCellPolygons,
  updateGroupedMarkerCellInteractions,
} from './groupedMarkerCell.js';

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

const topmostTie = { id: 'topmost-tie' };
const topmost = { id: 'topmost' };
const nearbyTop = { id: 'nearby-top' };
const separate = { id: 'separate' };
const groupPoints = new Map([
  [topmostTie, { x: 102, y: 110 }],
  [topmost, { x: 100, y: 110 }],
  [nearbyTop, { x: 100, y: 95 }],
  [separate, { x: 200, y: 0 }],
]);
const proximityGroups = groupMarkersByProximity(
  [nearbyTop, topmostTie, topmost, separate],
  (marker) => groupPoints.get(marker),
);

assert.deepEqual(
  proximityGroups.map((group) => ({
    representative: group.representative.id,
    members: group.members.map((marker) => marker.id),
  })),
  [
    {
      // Equal projected Y values use the later source marker as the topmost tie.
      representative: 'topmost',
      members: ['topmost', 'topmost-tie', 'nearby-top'],
    },
    { representative: 'separate', members: ['separate'] },
  ],
);
assert.equal(
  proximityGroups.flatMap((group) => group.members).length,
  4,
);

assert.deepEqual(getGroupedMarkerCellPolygons({
  bounds: { north: 10, south: 0, east: 10, west: 0 },
  grid: { cellLat: 0, cellLon: 1, cellHeight: 10, cellWidth: 5 },
}), [[
  [0, 5],
  [0, 10],
  [10, 10],
  [10, 5],
]]);
assert.deepEqual(getGroupedMarkerCellPolygons({
  bounds: { north: 10, south: 0, east: -170, west: 170 },
  grid: { cellLat: 0, cellLon: 0, cellHeight: 10, cellWidth: 20 },
}), [
  [[0, 170], [0, 180], [10, 180], [10, 170]],
  [[0, -180], [0, -170], [10, -170], [10, -180]],
]);

let interactionState = updateGroupedMarkerCellInteractions(
  new Set(),
  'grouped-point',
  'hover',
  true,
);
assert.equal(interactionState.remainsActive, true);
interactionState = updateGroupedMarkerCellInteractions(
  interactionState.interactions,
  'grouped-point',
  'focus',
  true,
);
interactionState = updateGroupedMarkerCellInteractions(
  interactionState.interactions,
  'grouped-point',
  'hover',
  false,
);
assert.equal(interactionState.remainsActive, true);
interactionState = updateGroupedMarkerCellInteractions(
  interactionState.interactions,
  'grouped-point',
  'focus',
  false,
);
assert.equal(interactionState.remainsActive, false);

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
  assert.match(singleMarkup, /aria-label="Marker details"/);
  assert.doesNotMatch(singleMarkup, />Marker details</);

  for (const renderType of ['grouped', 'representative']) {
    const groupedMarkup = renderToStaticMarkup(React.createElement(
      MarkerDetailsPanel,
      {
        marker: {
          ...clicked,
          renderType,
          count: 2,
          groupRef: { queryId: 'group-query' },
        },
        markers: [],
        leftOffset: 420,
        getGroupRows() {},
        isCollapsed: false,
        onToggleCollapse() {},
        onClose() {},
      },
    ));

    assert.match(groupedMarkup, /class="groupedMarkerDetails"/);
    assert.match(groupedMarkup, /class="groupedMarkerDetailsHeading"/);
    assert.match(groupedMarkup, /class="groupedMarkerRowsSection"/);
    assert.doesNotMatch(groupedMarkup, /class="groupedMarkerShowMore"/);
    assert.doesNotMatch(groupedMarkup, /max-width:420px/);
  }

  const collapsedMarkup = renderToStaticMarkup(React.createElement(
    MarkerDetailsPanel,
    {
      marker: clicked,
      markers: [clicked],
      leftOffset: 420,
      isCollapsed: true,
      onToggleCollapse() {},
      onClose() {},
    },
  ));

  assert.match(
    collapsedMarkup,
    /class="markerDetailsPanelClose markerDetailsPanelCollapsedClose"/,
  );
  assert.match(
    collapsedMarkup,
    /class="markerDetailsPanelExpandRail"[^>]*aria-label="Expand marker details"/,
  );
  assert.doesNotMatch(collapsedMarkup, /&gt;/);
  assert.match(
    collapsedMarkup,
    /class="markerDetailsPanelHeader" hidden=""/,
  );
  assert.match(
    collapsedMarkup,
    /class="markerDetailsPanelContent" hidden=""/,
  );
} finally {
  await vite.close();
}

console.log('Marker proximity-selection smoke test passed.');
