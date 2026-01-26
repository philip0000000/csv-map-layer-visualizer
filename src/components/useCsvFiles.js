import { useEffect, useMemo, useState } from "react";
import { parseCsvFile, parseCsvText } from "./csvParse";
import { autoDetectLatLon } from "./geoColumns";

/**
 * React hook that manages loaded CSV files (in-memory only).
 * - Allows importing multiple CSV files
 * - Keeps track of the currently selected file
 *
 * Notes:
 * - Parsed CSV rows are intentionally NOT persisted to sessionStorage/localStorage.
 *   Large datasets can exceed browser storage quotas.
 * - Demo/example loading is handled via importExampleFile() (e.g. ?example=books.csv).
 *
 * - Auto-detect latitude/longitude columns on import (when possible)
 * - Provide updateFileMapping() so UI can change mapping later
 */
export function useCsvFiles() {
  // List of loaded CSV files.
  const [files, setFiles] = useState([]); // Empty defaults
  // ID of the currently selected CSV file.
  const [selectedId, setSelectedId] = useState(null);

  /**
   * Ensure selectedId always points to a valid file.
   */
  useEffect(() => {
    // If all files were removed, clear selection.
    if (files.length === 0) {
      setSelectedId(null);
      return;
    }

    // If selected file no longer exists, select the first file.
    if (!files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

  // The currently selected CSV file object.
  // Returns null if nothing is selected.
  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId]
  );

  /**
   * Import one or more CSV files.
   * Files are parsed client-side only.
   *
   * On import we also try to auto-detect the lat/lon columns
   * based on common header names.
   */
  async function importFiles(fileList) {
    // Hard limit to avoid memory issues with huge imports.
    const MAX_FILES = 100;

    // Calculate how many files we can still accept.
    const remainingSlots = Math.max(0, MAX_FILES - files.length);

    // Ignore extra files if limit is exceeded.
    const toAdd = fileList.slice(0, remainingSlots);

    const newItems = [];

    for (const file of toAdd) {
      // Parse CSV content into structured data.
      const parsed = await parseCsvFile(file);

      // Auto-detect mapping from headers.
      // This does not change parsing; it only saves suggested column names.
      const { latField, lonField } = autoDetectLatLon(parsed.headers);

      // Keep parse warnings, and add a warning if mapping could not be detected.
      const parseErrors = Array.isArray(parsed.parseErrors)
        ? [...parsed.parseErrors]
        : [];

      if (!latField || !lonField) {
        parseErrors.push(
          "Geo: Could not auto-detect latitude/longitude columns. Choose them manually."
        );
      }

      // Build internal representation of the CSV file.
      const item = {
        // Use crypto.randomUUID if available, fallback otherwise.
        id: crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,

        name: file.name,
        size: file.size,
        lastModified: file.lastModified,

        headers: parsed.headers,
        rows: parsed.rows,
        previewRows: parsed.previewRows,
        totalRows: parsed.totalRows,
        parseErrors,

        // Stored per file for the current session.
        latField: latField ?? null,
        lonField: lonField ?? null,
      };

      newItems.push(item);
    }

    // Add new files to the front of the list.
    // Newest files appear first in the UI.
    setFiles((prev) => [...newItems, ...prev]);

    // Automatically select the most recently imported file.
    if (newItems.length > 0) {
      setSelectedId(newItems[0].id);
    }
  }

  /**
   * Import one CSV file from /public/examples via URL.
   * Intended for the GitHub Pages demo via:
   * ?example=books.csv
   */
  async function importExampleFile(exampleFileName) {
    const name = String(exampleFileName ?? "").trim();

    // Security: allow only simple filenames like "books.csv"
    // No slashes, no "..", must end with .csv
    if (!/^[a-zA-Z0-9._-]+\.csv$/.test(name)) return;

    const url = `${import.meta.env.BASE_URL}examples/${name}`;

    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) {
      // Optional: you could surface this as a UI error later
      return;
    }

    const text = await res.text();
    const parsed = parseCsvText(text);

    const { latField, lonField } = autoDetectLatLon(parsed.headers);

    const parseErrors = Array.isArray(parsed.parseErrors)
      ? [...parsed.parseErrors]
      : [];

    if (!latField || !lonField) {
      parseErrors.push(
        "Geo: Could not auto-detect latitude/longitude columns. Choose them manually."
      );
    }

    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,

      // Show the filename in the dropdown so it's clear it came from examples/
      name,
      // Approximate (characters), good enough for UI
      size: text.length,
      lastModified: null,

      headers: parsed.headers,
      rows: parsed.rows,
      previewRows: parsed.previewRows,
      totalRows: parsed.totalRows,
      parseErrors,

      latField: latField ?? null,
      lonField: lonField ?? null,
    };

    setFiles((prev) => [item, ...prev]);
    setSelectedId(item.id);
  }

  /**
   * Remove the currently selected CSV file.
   */
  function unloadSelected() {
    if (!selectedId) return;

    setFiles((prev) => prev.filter((f) => f.id !== selectedId));
  }

  /**
   * Update one file with a small patch object.
   * This is used when the user chooses lat/lon columns manually.
   *
   * Example patch:
   * { latField: "latitude", lonField: "longitude" }
   */
  function updateFileMapping(fileId, patch) {
    if (!fileId || !patch) return;

    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== fileId) return f;
        return { ...f, ...patch };
      })
    );
  }

  // Public API of this hook.
  return {
    files, // all loaded CSV files
    selectedId, // ID of selected CSV
    selected, // selected CSV object (or null)
    setSelectedId, // allow UI to change selection
    importFiles, // import new CSV files
    importExampleFile, // import one CSV from /public/examples via URL
    unloadSelected, // remove selected CSV
    updateFileMapping, // update lat/lon mapping for a file
  };
}


