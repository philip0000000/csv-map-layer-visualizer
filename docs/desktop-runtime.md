# Desktop Runtime Decision

Issue #80 chooses the first desktop shell for running this app as a local PC program.

## Decision

Use Electron as the initial desktop shell.

## Rationale

The app is currently a React and Vite browser app that also deploys to GitHub Pages. The desktop runtime should let the existing app run locally without changing the normal browser build or user-facing behavior.

Tauri was considered because it is lightweight and a strong technical fit for a Vite frontend. However, future desktop-only work for this project is expected to involve local files, local storage, SQLite, CSV import/indexing, and app-managed data access. Electron keeps that desktop-side work in JavaScript and Node.js, which fits the maintainer's existing skill set and should make the project easier to debug and maintain.

The accepted tradeoff is that Electron is heavier than Tauri. For this project, maintainability and a familiar desktop backend are more important than minimizing the desktop shell footprint.

## Scope

The browser app remains the primary web build and should continue to work on GitHub Pages.

Desktop-specific code should stay isolated from the browser app where practical. The first Electron integration should only prove that the existing app can launch and render inside a desktop window.

This decision does not include SQLite, local indexed data-source queries, grouped marker behavior, or changes to CSV parsing.

## Running Locally

The desktop shell currently runs from npm scripts. It does not create a standalone `.exe` or installer yet.

To build the desktop-mode Vite app and open it in Electron:

```bash
npm run desktop:start
```

To run the desktop shell against the Vite development server:

```bash
npm run desktop:dev
```

Installer or packaged executable output should be handled by a separate packaging issue.

## Related Desktop Data Work

- [SQLite import prototype](./sqlite-import-prototype.md)
