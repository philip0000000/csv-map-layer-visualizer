# Temporary SQLite WASM Prototype

Issue #102 tests whether a temporary, in-memory SQLite database can run in a dedicated Web Worker in the normal GitHub Pages build. It does not replace the browser CSV flow or the Electron SQLite implementation.

## Prototype URL

The production build emits a separate page at:

```text
/csv-map-layer-visualizer/sqlite-wasm-prototype.html
```

After a deployment from `main`, its expected public URL is:

```text
https://philip0000000.github.io/csv-map-layer-visualizer/sqlite-wasm-prototype.html
```

The page is intentionally not linked from the normal application UI.

For local development, run `npm run dev` and open `/sqlite-wasm-prototype.html`. To exercise the GitHub Pages base path locally, run `npm run build`, then `npm run preview`, and open the production path shown above.

## Package Decision

The prototype uses the exact dependency `sql.js@1.14.1` and imports its browser-specific WASM pair:

- `sql.js/dist/sql-wasm-browser.js`
- `sql.js/dist/sql-wasm-browser.wasm`

`sql.js` was selected because this prototype needs an in-memory database in a dedicated worker without server-controlled cross-origin isolation headers. The official `@sqlite.org/sqlite-wasm` worker configuration requires cross-origin isolation headers that GitHub Pages does not provide. `wa-sqlite` was also considered, but `sql.js` provides the smallest direct compatibility proof for the current scope.

The dependency is pinned in `package.json` and `package-lock.json`. During the prototype review, the npm registry metadata, repository, maintainers, license, package integrity, lifecycle scripts, and runtime dependencies were checked. The downloaded tarball matched the lockfile integrity, the package has no runtime dependencies or install scripts, and a local Microsoft Defender scan reported no threats. These checks reduce supply-chain risk but cannot prove that any third-party package is completely risk-free.

## Isolation and Worker Protocol

The prototype is isolated under `src/prototypes/sqliteWasm/`. The normal React entry point does not import it.

The main thread sends named operations instead of arbitrary SQL:

- `initialize`
- `seed-sample-data`
- `get-summary`
- `query-viewport`
- `get-feature-detail`
- `close`

Every request has an ID and a 30-second timeout. The worker returns structured success or error messages. The database exists only in worker memory and is closed when the worker is terminated.

## Representative Schema and Workflow

The temporary database mirrors the existing desktop prototype's `datasets` and `features` shape, including dataset, coordinate, timeline, and stable source-row indexes.

The compatibility page:

1. Starts a dedicated module worker.
2. Creates a fresh in-memory database and schema.
3. Generates 30,000 deterministic point rows across three geographic regions.
4. Inserts all rows in one transaction.
5. Runs named summary, viewport, and detail queries.
6. Terminates the first worker.
7. Starts a second worker and verifies that both tables are empty.

The fixture is generated at runtime and is never committed or persisted.

## Local Validation Results

The final production-build check was run in headless Chrome on Windows on 2026-07-24. Timings are environment-specific and are intended as prototype evidence, not performance guarantees.

| Scenario | Observed result |
| --- | --- |
| SQLite version | 3.49.1 |
| Transactional insert | 30,000 rows in 312.3 ms |
| Dataset/feature summary | 1 dataset and 30,000 features |
| Stockholm viewport | 10,000 matches; 25 returned in 12.7 ms |
| Exact detail lookup | Expected source row returned in 0.2 ms |
| Worker restart | 0 datasets and 0 features |
| Cross-origin isolation | Not enabled or required |
| `SharedArrayBuffer` | Not required |

The production build emitted:

- a 47.35 kB worker bundle
- a 659.73 kB WASM asset (323.01 kB gzip)
- the standalone prototype HTML and main-thread module

The normal application entry continued to return HTTP 200 during the same production-preview validation.

## GitHub Pages Build

`vite.config.js` includes both `index.html` and `sqlite-wasm-prototype.html` as Rollup inputs and emits workers as ES modules. The existing Pages workflow runs `npm run build` and uploads the complete `dist` directory, so no workflow change is required.

The build output uses the repository base path for the page, worker, JavaScript, and WASM URLs. The browser-specific `sql.js` artifacts also avoid the `node:fs` and `node:crypto` externalization warnings produced by the general distribution.

## Required Follow-Up Cleanup

This is temporary experimental code and must not remain indefinitely as a parallel implementation.

If SQLite WASM is adopted, move the required database and worker logic into production modules, add production-focused automated tests, and then remove the standalone experiment:

- `sqlite-wasm-prototype.html`
- `src/prototypes/sqliteWasm/`
- the `sqliteWasmPrototype` Vite page input
- the prototype link in `README.md`

Keep the `sql.js` dependency and ES-module worker configuration only when the production implementation still uses them. Replace or revise this document so it describes the production design or preserves only the useful decision record.

If SQLite WASM is rejected, remove all items above, remove `sql.js` from `package.json` and `package-lock.json`, and remove the worker configuration when nothing else requires it. This document may remain as a historical decision record after its instructions and links are updated.

The adopting or rejecting follow-up must include this cleanup in its acceptance criteria. The prototype should not be treated as the production integration merely because it is present in the GitHub Pages build.

## Limitations and Non-Goals

This prototype:

- has only been runtime-validated in Chrome
- uses generated data rather than imported user CSV files
- does not persist data across workers, reloads, or browser sessions
- does not expose a general SQL API
- is not connected to React state, the map, or the normal CSV workflow
- does not change or replace the Electron `better-sqlite3` path
- has not been verified on the public GitHub Pages deployment yet

Committing, pushing, deploying, integrating the worker with the application, and deciding whether browser SQLite should become a supported feature are separate follow-up decisions.
