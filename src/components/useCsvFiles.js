import { useEffect, useMemo, useState } from "react";
import { parseCsvFile } from "./csvParse";

// Key used to store CSV state in sessionStorage.
// sessionStorage survives page refresh, but not a new tab.
const STORAGE_KEY = "csv-map-layer-visualizer.csvFiles.v1";

/**
 * React hook that manages loaded CSV files.
 * - Loads CSVs from sessionStorage on startup
 * - Allows importing multiple CSV files
 * - Keeps track of the currently selected file
 * - Persists state for the lifetime of the browser tab
 */
export function useCsvFiles() {

  // List of loaded CSV files.
  // On first load, try to restore from sessionStorage.
  const [files, setFiles] = useState(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // If stored data is corrupted, start fresh.
      return [];
    }
  });

  // ID of the currently selected CSV file.
  // Default is the first stored file, if any.
  const [selectedId, setSelectedId] = useState(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return parsed?.[0]?.id ?? null;
    } catch {
      return null;
    }
  });

  /**
   * Persist CSV files to sessionStorage whenever they change.
   * Also ensures that selectedId always points to a valid file.
   */
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(files));

    // If all files were removed, clear selection.
    if (files.length === 0) {
      setSelectedId(null);
    }
    // If selected file no longer exists, select the first file.
    else if (!files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }

    // selectedId is intentionally NOT a dependency here.
    // Selection is derived from files, not the other way around.
  }, [files]);

  // The currently selected CSV file object.
  // Returns null if nothing is selected.
  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId]
  );

  /**
   * Import one or more CSV files.
   * Files are parsed client-side only.
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
        parseErrors: parsed.parseErrors,
      };

      newItems.push(item);
    }

    // Add new files to the front of the list.
    // Newest files appear first in the UI.
    setFiles((prev) => {
      const merged = [...newItems, ...prev];
      return merged;
    });

    // Automatically select the most recently imported file.
    if (newItems.length > 0) {
      setSelectedId(newItems[0].id);
    }
  }

  /**
   * Remove the currently selected CSV file.
   */
  function unloadSelected() {
    if (!selectedId) return;

    setFiles((prev) =>
      prev.filter((f) => f.id !== selectedId)
    );
  }

  // Public API of this hook.
  return {
    files,           // all loaded CSV files
    selectedId,      // ID of selected CSV
    selected,        // selected CSV object (or null)
    setSelectedId,   // allow UI to change selection
    importFiles,     // import new CSV files
    unloadSelected,  // remove selected CSV
  };
}


