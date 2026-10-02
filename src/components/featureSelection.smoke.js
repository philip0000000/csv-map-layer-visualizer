import assert from 'node:assert/strict';
import {
  featureSelectionKey,
  applyCommittedZoneToSelection,
  getDisplayedRegion,
  isFeatureSelected,
  selectionMatchesTimeline,
  selectionTimelineKey,
  refreshSelectionGroupRef,
} from './featureSelection.js';

const zone = {
  id: 'dataset-a:zone:main', featureId: 'zone', part: 'main', selectionKind: 'region',
  sourceRef: { datasetId: 'dataset-a', rowIndex: 3 }, coordinates: [[1, 2], [3, 4], [5, 6]],
};
const otherPart = { ...zone, id: 'dataset-a:zone:island', part: 'island' };
assert.equal(featureSelectionKey(zone), featureSelectionKey(otherPart));
assert.equal(isFeatureSelected(otherPart, 'region', zone), true);
assert.equal(isFeatureSelected({ ...zone, sourceRef: { datasetId: 'dataset-b', rowIndex: 3 } }, 'region', zone), false);
assert.equal(isFeatureSelected(zone, 'line', zone), false);

const timeline = { timelineEnabled: true, startYear: 1000, endYear: 1100 };
for (const [extent, expected] of [
  [{ startYear: 1000, endYear: 1000 }, true],
  [{ startYear: 1100, endYear: 1100 }, true],
  [{ startYear: 999, endYear: 999 }, false],
  [{ startYear: 900, endYear: 1200 }, true],
  // Desktop can store reversed endpoints; do not silently turn them into a browser-style range.
  [{ startYear: 1200, endYear: 900 }, false],
  [null, false],
]) assert.equal(selectionMatchesTimeline({ timelineExtent: extent }, timeline), expected);
assert.equal(selectionMatchesTimeline({}, { timelineEnabled: false }), true);
assert.equal(selectionTimelineKey(timeline), selectionTimelineKey({ ...timeline, startYear: 1100, endYear: 1000 }));
const groupRef = {
  datasetIds: ['a', 'b'], bounds: { north: 2, south: 1, west: 1, east: 2 },
  grid: { cellLat: 0, cellLon: 0 }, timeline: null,
};
const refreshed = refreshSelectionGroupRef(groupRef, ['b', 'new-dataset'], selectionTimelineKey(timeline));
assert.deepEqual(refreshed.datasetIds, ['b']);
assert.equal(refreshed.bounds, groupRef.bounds);
assert.equal(refreshed.grid, groupRef.grid);
assert.deepEqual(refreshed.timeline, timeline);
assert.deepEqual(groupRef.datasetIds, ['a', 'b']);

// Full edit payloads may contain invisible parts; previewing must not append them to the map.
const editedPart = { part: 'main', coordinates: [[2, 3], [4, 5], [6, 7]], style: { color: 'red' } };
const logicalZone = { datasetId: 'dataset-a', featureId: 'zone', parts: [editedPart, { part: 'hidden' }] };
assert.deepEqual(getDisplayedRegion(zone, zone, logicalZone, null).coordinates, editedPart.coordinates);
assert.equal(getDisplayedRegion(otherPart, zone, logicalZone, null), otherPart);
assert.equal(getDisplayedRegion(zone, null, logicalZone, null), zone);
const preview = { ...editedPart, coordinates: [[3, 4], [5, 6], [7, 8]] };
assert.deepEqual(getDisplayedRegion(zone, zone, logicalZone, [preview]).coordinates, preview.coordinates);
assert.equal(getDisplayedRegion(zone, zone, { ...logicalZone, datasetId: 'other' }, [preview]), zone);

// The fallback uses the committed part even after it leaves the viewport query.
const selection = { feature: zone, request: Promise.resolve(null) };
const committedSelection = applyCommittedZoneToSelection(selection, logicalZone);
assert.deepEqual(committedSelection.feature.coordinates, editedPart.coordinates);
assert.equal(committedSelection.request, selection.request);
assert.notDeepEqual(committedSelection.feature.coordinates, zone.coordinates);
assert.equal(applyCommittedZoneToSelection(null, logicalZone), null);
assert.equal(applyCommittedZoneToSelection(selection, { ...logicalZone, datasetId: 'other' }), selection);
assert.equal(applyCommittedZoneToSelection({ feature: { ...zone, featureId: 'another' } }, logicalZone).feature.featureId, 'another');
assert.equal(applyCommittedZoneToSelection(selection, { ...logicalZone, parts: [] }), null);
console.log('Feature selection smoke test passed.');
