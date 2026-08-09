import assert from 'node:assert/strict';
import {
  calculateZoneTransformCenter,
  getZoneDragOperation,
  isEditableInteractionTarget,
  shouldApplyZoneCommit,
  transformZoneParts,
} from './zoneTransform.js';

const parts = [
  { part: 'main', coordinates: [[0, 0], [0, 2], [2, 2], [0, 0]] },
  { part: 'island', coordinates: [[4, 4], [4, 5], [5, 5], [4, 4]] },
];
const center = calculateZoneTransformCenter(parts);
assert.ok(center);
assert.equal(getZoneDragOperation({}), 'move');
assert.equal(getZoneDragOperation({ zHeld: true }), 'rotate');
assert.equal(getZoneDragOperation({ xHeld: true }), 'scale');
assert.equal(getZoneDragOperation({ zHeld: true, xHeld: true }), null);
assert.equal(isEditableInteractionTarget({ tagName: 'INPUT' }), true);
assert.equal(isEditableInteractionTarget({ tagName: 'DIV' }), false);

const currentCommit = {
  enabled: true,
  interactionId: 4,
  latestInteractionId: 4,
  selectedZone: { datasetId: 'dataset-a', featureId: 'zone-a' },
  datasetId: 'dataset-a',
  featureId: 'zone-a',
};
assert.equal(shouldApplyZoneCommit(currentCommit), true);
assert.equal(shouldApplyZoneCommit({ ...currentCommit, enabled: false }), false);
assert.equal(shouldApplyZoneCommit({ ...currentCommit, latestInteractionId: 5 }), false);
assert.equal(shouldApplyZoneCommit({
  ...currentCommit,
  selectedZone: { datasetId: 'dataset-a', featureId: 'zone-b' },
}), false);

const moved = transformZoneParts(parts, {
  operation: 'move',
  center,
  start: center,
  current: { lat: center.lat + 1, lng: center.lng + 1 },
});
assert.equal(moved.length, 2);
assert.deepEqual(moved[0].coordinates[0], moved[0].coordinates.at(-1));
assert.ok(Math.abs(moved[1].coordinates[0][0] - moved[0].coordinates[0][0] - 4) < 1e-9);

const rotated = transformZoneParts(parts, {
  operation: 'rotate',
  center,
  start: { lat: center.lat, lng: center.lng + 1 },
  current: { lat: center.lat + 1, lng: center.lng },
});
assert.equal(rotated.length, 2);
assert.deepEqual(rotated[1].coordinates[0], rotated[1].coordinates.at(-1));

const scaled = transformZoneParts(parts, {
  operation: 'scale',
  center,
  start: { lat: center.lat, lng: center.lng + 1 },
  current: { lat: center.lat, lng: center.lng + 2 },
});
assert.equal(scaled.length, 2);
assert.equal(transformZoneParts(parts, {
  operation: 'scale',
  center,
  start: center,
  current: center,
}), null);

console.log('Zone adjustment smoke checks passed.');
