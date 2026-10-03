import assert from 'node:assert/strict';
import { getInitialMapToolsState } from './useMapToolsState.js';
import { toHeatContributions, getHeatOptions, normalizeHeatRadius } from './heatmap.js';

const exact = { lat: 59.3, lon: 18.1, renderType: 'exact', count: 100 };
const grouped = { lat: 59.4, lon: 18.2, renderType: 'grouped', count: 50 };
assert.deepEqual(toHeatContributions([exact, exact]), [[59.3, 18.1, 1], [59.3, 18.1, 1]]);
assert.deepEqual(toHeatContributions([grouped]), [[59.4, 18.2, 50]]);
assert.equal(toHeatContributions([{ ...grouped, renderType: 'representative' }])[0][2], 50);
assert.deepEqual(toHeatContributions([]), []);
assert.deepEqual(toHeatContributions([{ ...grouped, count: 0 }, { lat: NaN, lon: 0 }]), []);
assert.equal(toHeatContributions([exact, grouped]).reduce((sum, point) => sum + point[2], 0), 51);
assert.equal(normalizeHeatRadius(''), 25);
assert.equal(normalizeHeatRadius('bad', 30), 30);
assert.equal(normalizeHeatRadius('-1'), 5);
assert.equal(normalizeHeatRadius('1000'), 100);
assert.equal(normalizeHeatRadius('35.7'), 35);
// A timeline change can replace data, but cannot change the colour scale options.
assert.equal(getHeatOptions(10).max, getHeatOptions(50).max);
assert.equal(getHeatOptions().maxZoom, 0);
const initial = getInitialMapToolsState();
assert.equal(initial.heatmapEnabled, false);
assert.equal(initial.heatmapShowMarkers, true);
assert.equal(initial.heatRadius, 25);
console.log('Heatmap contribution and state smoke checks passed.');
