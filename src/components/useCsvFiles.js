import { useCallback, useMemo } from 'react';

const EMPTY_SUMMARY = Object.freeze({
  datasets: Object.freeze([]),
  selectedDatasetId: null,
  timeline: null,
});

/**
 * Browser view controller over the already-selected session DataSource.
 * It never creates a second backend and remains inactive in desktop sessions.
 */
export function useCsvFiles({ dataSource, dataRevision, enabled }) {
  const summary = useMemo(() => {
    if (!enabled) return EMPTY_SUMMARY;
    // The selected in-memory adapter mutates internally; revision invalidates reads.
    void dataRevision;
    return dataSource.getDatasetSummary();
  }, [dataRevision, dataSource, enabled]);
  const selectedId = summary.selectedDatasetId;

  // Preserve the panel's current view model while sourcing the selected preview
  // through the contract. Non-selected complete rows stay out of React state.
  const files = useMemo(() => summary.datasets.map((dataset) => {
    const isSelected = dataset.id === selectedId;
    const preview = isSelected
      ? dataSource.getPreviewPage({
          datasetId: dataset.id,
          offset: 0,
          limit: Math.max(dataset.rowCount, 30),
        })
      : null;

    return {
      ...dataset,
      size: dataset.sizeBytes,
      rows: preview?.rows ?? [],
    };
  }), [dataSource, selectedId, summary.datasets]);

  const selected = useMemo(
    () => files.find((file) => file.id === selectedId) ?? null,
    [files, selectedId],
  );

  const setSelectedId = useCallback((datasetId) => (
    enabled ? dataSource.selectDataset(datasetId) : null
  ), [dataSource, enabled]);

  const importFiles = useCallback((fileList) => (
    enabled
      ? dataSource.importBrowserFiles({ files: Array.from(fileList ?? []) })
      : null
  ), [dataSource, enabled]);

  const importDroppedFiles = useCallback((fileList) => (
    enabled
      ? dataSource.importDroppedFiles({ files: Array.from(fileList ?? []) })
      : null
  ), [dataSource, enabled]);

  const importExampleFile = useCallback((name) => (
    enabled ? dataSource.importExample({ name }) : null
  ), [dataSource, enabled]);

  const unloadFile = useCallback((datasetId) => (
    enabled ? dataSource.removeDataset(datasetId) : null
  ), [dataSource, enabled]);

  const unloadSelected = useCallback(() => (
    enabled && selectedId ? dataSource.removeDataset(selectedId) : null
  ), [dataSource, enabled, selectedId]);

  const updateFileEnabled = useCallback((datasetId, visible) => (
    enabled ? dataSource.setDatasetEnabled(datasetId, !!visible) : null
  ), [dataSource, enabled]);

  const updateFileMapping = useCallback((datasetId, mapping) => (
    enabled ? dataSource.updateDatasetMapping(datasetId, mapping) : null
  ), [dataSource, enabled]);

  return {
    files,
    selectedId,
    selected,
    setSelectedId,
    importFiles,
    importDroppedFiles,
    importExampleFile,
    unloadSelected,
    unloadFile,
    updateFileEnabled,
    updateFileMapping,
  };
}
