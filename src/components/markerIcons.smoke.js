import assert from 'node:assert/strict';

// Leaflet performs browser feature detection during import. These minimal DOM
// shapes let this smoke test inspect icon configuration without rendering a map.
globalThis.window = {
  cancelAnimationFrame: null,
  devicePixelRatio: 1,
  requestAnimationFrame: null,
  screen: { deviceXDPI: 1, logicalXDPI: 1 },
};
globalThis.document = {
  addEventListener() {},
  createElement() {
    return { getContext: () => null, style: {} };
  },
  documentElement: { style: {} },
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { platform: '', userAgent: '' },
});

const {
  getClusterMarkerIcon,
  getCountedMarkerIcon,
} = await import('./markerIcons.js');

const restoredDefault = getCountedMarkerIcon(null, 1);
assert.ok(restoredDefault);
assert.equal(restoredDefault.options.html, undefined);

const countedDefault = getCountedMarkerIcon(null, 2);
assert.match(countedDefault.options.html, /csv-marker-counted-default-pin/);
assert.match(countedDefault.options.html, />2<\/span>/);

const exactLargeCount = getCountedMarkerIcon('📜', 30_000);
assert.match(exactLargeCount.options.html, />30000<\/span>/);
assert.doesNotMatch(exactLargeCount.options.html, /9999\+/);

// Ordinary Cluster marker formatting is intentionally unchanged by issue #144.
const clusterCount = getClusterMarkerIcon('📜', 30);
assert.match(clusterCount.options.html, />30<\/span>/);

console.log('Marker icon smoke test passed.');
