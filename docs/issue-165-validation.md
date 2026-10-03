# Issue #165: optional point concentration heatmap

## Dependency inspection

Reviewed the published `leaflet.heat@0.2.0` archive without executing its scripts.
Its SHA-512 matches npm metadata and the lockfile:

`sha512-Cd5PbAA/rX3X3XKxfDoUGi9qp78FyhWYurFg3nsfhntcM/MCNK08pRkf4iEenO1KNqwVPKCmkyktjW3UD+h9bQ==`

The executable `dist/leaflet-heat.js` matches the official upstream `v0.2.0`
distribution (comparison normalized trailing whitespace). Inspected that bundled
renderer and the included source. No obvious network, upload or dynamic execution
behaviour was found. This is a source inspection, not a guarantee of security.
The package has no runtime dependencies or install hooks. Its old development
build tools are not added to this project's dependencies. Installation used
`--ignore-scripts`; the exact version is pinned and bundled locally.

Upstream: <https://github.com/Leaflet/Leaflet.heat/tree/v0.2.0>

## Behaviour

- Heatmap defaults to off; Show markers defaults to checked per the user's
  follow-up preference. Users can uncheck it for a heat-only view.
- Exact points have weight 1; summaries retain their represented record count.
- Image-backed points contribute at their point coordinates and follow Show markers.
- Heat radius defaults to 25 pixels and is bounded to 5–100 pixels; blur is 15.
- A native range slider updates radius immediately while dragging or using arrow
  keys. Its label displays the current pixel value; radius changes do not query SQLite.
- The fixed intensity maximum is 10. Timeline frames do not normalize themselves.
  Plugin zoom attenuation is disabled so map background max-zoom changes cannot
  silently change the scale. Screen-space overlaps still change when zooming.
- The wrapper adapts the old plugin's pane placement and cancels queued draws
  on removal. It does not patch package files.
- Heat is below CSV vectors; the legend sits above the bottom-right zoom control
  so the CSV sidebar does not obscure it. Both pass pointer events through.
- Visibility and data revisions clear heat immediately. Timeline/viewport refreshes
  retain the last completed frame until another filtered result is ready; a completed
  empty result clears heat. This avoids flashing blank between playback ticks.
- Heatmap playback bypasses the 100 ms manual-navigation debounce. A shared query
  scheduler runs one query at a time and coalesces busy ticks into the latest pending
  request. Completed playback frames can publish while newer ticks are pending if
  the dataset/revision context and viewport still match. Hidden/mutated datasets and
  obsolete manual queries cannot publish old heat.

## Validation

Passed:

- `npm run smoke:heatmap` (contributions/state plus slow-query playback scheduling,
  coalescing, manual debounce, visibility invalidation and disposal)
- `npm run smoke:map-tools`
- `npm run smoke:browser-sqlite-points`
- `npm run smoke:sqlite-viewport`
- Existing `desktop/mapFeatureSelectionValidation.cjs` renderer regression
- `npm run validate:heatmap` (real canvas, StrictMode, marker toggles, vectors,
  empty results, 1,000 summaries representing 30,000 records, removal/re-enable;
  actual shared query and timeline-playback hooks at 100 ms ticks with 30/160 ms
  query delays, progressive frames, dense zoom/pan, and dataset hiding in-flight)
- `npm run lint`
- `npm run build` and `npm run build:desktop`

Electron rendering required running outside the execution sandbox after its GPU
process could not initialize inside it. The renderer remains sandboxed.
Builds report the bundle-size warning; no unrelated bundling changes were made.

Browser UI inspection used the actual app with `?example=books.csv`: enabled heat,
verified marker hiding and Show markers, changed radius, hid/restored the dataset,
and restricted the timeline to year 0. Heat cleared/restored as expected and no
browser console errors were recorded. The legend placement was visually checked.

`validate:heatmap` writes a temporary screenshot to the operating-system temp
directory for visual inspection. No generated screenshots are tracked.

## Accepted limits and handoff

Existing summary coordinates are approximate. Existing viewport queries exclude
points outside their bounds, so heat near viewport edges remains an approximation.
No data-source aggregation rewrite or numeric CSV weighting was introduced.

The user completed smoke testing and confirmed the feature works as expected.
PR #166 was merged into `main`, and issue #165 is closed.
