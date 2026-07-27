/** Combine sequential normalized import batches without losing per-file results. */
export function mergeImportBatchResults(batchResults) {
  const batches = Array.from(batchResults ?? []).filter(isRecord);
  const results = batches.flatMap((batch) => (
    Array.isArray(batch.results) ? batch.results : []
  ));
  const successfulCount = results.filter((result) => result?.ok === true).length;
  const failedCount = results.length - successfulCount;
  const ok = successfulCount > 0;
  const canceled = !ok && batches.some((batch) => batch.canceled === true);

  return {
    ok,
    importId: null,
    canceled,
    successfulCount,
    failedCount,
    results,
    error: ok
      ? null
      : batches.find((batch) => batch.error)?.error ?? null,
  };
}

/** Match raw-file behavior by selecting the first successful dataset in a batch. */
export function getFirstImportedDatasetId(batchResult) {
  return Array.isArray(batchResult?.results)
    ? batchResult.results.find((result) => (
        result?.ok === true && typeof result.datasetId === 'string'
      ))?.datasetId ?? null
    : null;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
