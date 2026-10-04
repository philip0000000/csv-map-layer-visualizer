import assert from 'node:assert/strict';
import { geometryNavigationBounds, getFeatureNavigationTarget, navigateToFeature } from './featureMapNavigation.js';

assert.deepEqual(geometryNavigationBounds([[1, 179], [5, -179]]), { south: 1, north: 5, west: 179, east: 181 });
assert.deepEqual(geometryNavigationBounds([[1, -10], [5, 10]]), { south: 1, north: 5, west: -10, east: 10 });
assert.throws(() => geometryNavigationBounds([]), /no map geometry/);
// A complete logical zone includes parts absent from the current viewport.
const sourceRef = { datasetId: 'dataset', rowIndex: 0 };
const zoneTarget = await getFeatureNavigationTarget({
  getPreviewFeature: async () => ({ selectionKind: 'region', sourceRef, featureId: 'zone' }),
  getLogicalZone: async (query) => {
    assert.deepEqual(query, { datasetId: 'dataset', featureId: 'zone' });
    return { parts: [{ coordinates: [[0, 0], [1, 1]] }, { coordinates: [[20, 30], [21, 31]] }] };
  },
}, { sourceRef });
assert.deepEqual(zoneTarget.bounds, { south: 0, north: 21, west: 0, east: 31 });
const mixedZone = await getFeatureNavigationTarget({
  getPreviewFeature: async () => ({ selectionKind: 'point', lat: 0, lon: 0 }),
  getLogicalZone: async () => ({ parts: [{ coordinates: [
    [[59, 18], [60, 19], [59, 19], [59, 18]],
    [[59.1, 18.1], [59.2, 18.2], [59.1, 18.2], [59.1, 18.1]],
  ] }] }),
}, { geojsonComponent: true, featureId: 'geojson:0', sourceRef, coordinates: [[[59, 18], [60, 19], [59, 19], [59, 18]]] });
assert.deepEqual(mixedZone.bounds, { south: 59, north: 60, west: 18, east: 19 });
await assert.rejects(getFeatureNavigationTarget({ getPreviewFeature: async () => null }, { sourceRef }), /no longer available/);
const groupRef = { id: 'captured' };
assert.deepEqual(await getFeatureNavigationTarget({ getGroupBounds: async (query) => {
  assert.deepEqual(query, { groupRef });
  return zoneTarget.bounds;
} }, { groupRef }), zoneTarget);

const calls = [];
const map = {
  getContainer: () => ({ getBoundingClientRect: () => ({ left: 10, width: 1200, height: 800 }) }),
  getZoom: () => 8,
  getMaxZoom: () => 18,
  project: () => ({ x: 1000, y: 500 }),
  unproject: (point, zoom) => ({ point, zoom }),
  setView: (...args) => calls.push(args),
  fitBounds: (...args) => calls.push(args),
};
navigateToFeature(map, { point: [59, 18] }, 610);
assert.deepEqual(calls.pop(), [{ point: [700, 500], zoom: 8 }, 8, { animate: false }]);
navigateToFeature(map, zoneTarget, 610);
assert.deepEqual(calls.pop(), [[[0, 0], [21, 31]], {
  paddingTopLeft: [624, 24], paddingBottomRight: [24, 24], maxZoom: 18, animate: false,
}]);
assert.throws(() => navigateToFeature(map, zoneTarget, 1200), /Widen the window/);
assert.equal(calls.length, 0);
console.log('Feature map navigation smoke passed.');
