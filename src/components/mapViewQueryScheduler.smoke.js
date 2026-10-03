import assert from 'node:assert/strict';
import { createMapViewQueryScheduler } from './mapViewQueryScheduler.js';
import { getCurrentHeatPoints } from './heatmap.js';

const bounds = { north: 60, south: 59, west: 17, east: 19 };
const completed = [];
const requests = [];
let state = { result: null };
let active = 0;
let maxActive = 0;

/** Let one or more scheduler timers and asynchronous query completions settle. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createMapViewQueryScheduler({
  queryMapView: async (query) => {
    requests.push(query.timeline.endYear);
    maxActive = Math.max(maxActive, ++active);
    await pause(160);
    active--;
    return { points: [{ lat: 59.3, lon: 18.1, frame: query.timeline.endYear }] };
  },
  onStateChange: (update) => {
    state = typeof update === 'function' ? update(state) : update;
    if (state.status === 'loaded') completed.push(state.result.points[0].frame);
  },
});

/** Submit the same frame metadata that the App hook sends during playback. */
function schedule(frame, contextKey = 'visible', playback = true) {
  scheduler.schedule({ query: { bounds, zoom: 5, timeline: { endYear: frame } }, contextKey, playback });
}

try {
  // Queries deliberately take longer than 100 ms ticks: completed frames must
  // still publish, and obsolete pending ticks must not build an unbounded queue.
  schedule(0);
  for (let frame = 1; frame <= 6; frame++) {
    await pause(100);
    schedule(frame);
  }
  assert.ok(completed.length >= 2, 'Playback starved while ticks kept arriving');
  assert.equal(maxActive, 1, 'Playback queries overlapped');
  assert.ok(requests.length < 7, 'Busy ticks were not coalesced');
  assert.ok(getCurrentHeatPoints(state, 'visible', ['dataset']).length > 0);
  // Visibility invalidation must hide the last frame immediately, even before
  // an already-running query resolves. Its completion cannot restore old heat.
  schedule(7, 'hidden');
  assert.deepEqual(getCurrentHeatPoints(state, 'hidden', []), []);
  await pause(400);
  assert.equal(state.heatContextKey, 'hidden');
  const frameBeforeManual = completed.length;
  schedule(8, 'visible', false);
  schedule(9, 'visible', false);
  await pause(300);
  assert.equal(completed.length, frameBeforeManual + 1);
  assert.equal(completed.at(-1), 9, 'Manual debounce failed to retain the newest frame');
  scheduler.dispose();
  schedule(10);
  await pause(200);
  assert.equal(completed.at(-1), 9, 'Disposed scheduler published another result');
  console.log('Map-view playback scheduling smoke checks passed.');
} finally {
  scheduler.dispose();
}
