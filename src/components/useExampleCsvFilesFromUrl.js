import { useEffect, useRef } from "react";

export function useExampleCsvFilesFromUrl({ importExampleFile }) {
  // Prevent double-loading examples in React StrictMode (dev)
  const didAutoLoadRef = useRef(false);

  /**
   * Optional: auto-load example CSV files from the URL.
   * Example:
   *   ?example=books.csv&example=authors.csv
   *
   * Behavior:
   * - If one or more valid ?example=*.csv values are present:
   *   - The files are auto-loaded from /public/examples
   *   - Marker clustering is enabled by default to reduce visual noise
   * - Otherwise:
   *   - No file is auto-loaded
   *   - Clustering remains off by default
   *
   * This is intended for the live demo and shareable links.
   */
  useEffect(() => {
    // Guard against React 18 StrictMode double-invoking effects in development
    if (didAutoLoadRef.current) return;
    didAutoLoadRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const exampleValues = params.getAll("example");
    const validExamples = [];

    // Only auto-load when the value looks like a safe filename.
    for (const value of exampleValues) {
      const trimmed = String(value ?? "").trim();

      // Allow:
      // - books.csv
      // - present-day/books.csv
      // - debug/test_case.csv
      if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*\.csv$/.test(trimmed))
        continue;

      // Reject path traversal defensively
      if (trimmed.includes("..")) continue;

      validExamples.push(trimmed);
    }

    if (validExamples.length === 0) return;

    const loadExamples = async () => {
      for (const name of validExamples) {
        await importExampleFile(name);
      }
    };

    void loadExamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
