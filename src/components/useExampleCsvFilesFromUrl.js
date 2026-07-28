import { useEffect, useRef } from "react";

export function useExampleCsvFilesFromUrl({
  importExampleFile,
  importExampleFiles,
}) {
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
   * - Otherwise:
   *   - No file is auto-loaded
   * - Marker clustering keeps the shared Map tools default in either case
   *
   * This is intended for the live demo and shareable links.
   */
  useEffect(() => {
    // Guard against React 18 StrictMode double-invoking effects in development
    if (didAutoLoadRef.current) return;
    const canImportBatch = typeof importExampleFiles === "function";
    if (!canImportBatch && typeof importExampleFile !== "function") return;

    const validExamples = getExampleNamesFromSearch(window.location.search);

    if (validExamples.length === 0) return;
    didAutoLoadRef.current = true;

    const loadExamples = async () => {
      if (canImportBatch) {
        await importExampleFiles(validExamples);
        return;
      }
      for (const name of validExamples) {
        await importExampleFile(name);
      }
    };

    void loadExamples();
  }, [importExampleFile, importExampleFiles]);
}

/** Return safe example names in URL order, including repeated parameters. */
export function getExampleNamesFromSearch(search) {
  const params = new URLSearchParams(search);
  const validExamples = [];

  for (const value of params.getAll("example")) {
    const trimmed = String(value ?? "").trim();
    if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*\.csv$/.test(trimmed)) {
      continue;
    }
    if (trimmed.includes("..")) continue;
    validExamples.push(trimmed);
  }

  return validExamples;
}
