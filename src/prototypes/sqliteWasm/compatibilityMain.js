const resultElement = document.querySelector("#sqlite-wasm-result");
const OPERATION_TIMEOUT_MS = 30_000;
const SAMPLE_ROW_COUNT = 30_000;
const STOCKHOLM_BOUNDS = {
  north: 59.42,
  south: 59.28,
  east: 18.12,
  west: 17.98,
};

/**
 * Run a representative, isolated SQLite WASM workflow through named worker operations.
 * The normal CSV and map application never imports or calls this prototype.
 */
export async function runSqliteWasmCompatibilityCheck() {
  const firstWorker = createWorkerClient(showProgress);
  let firstWorkerClosed = false;

  try {
    const initialization = await firstWorker.request("initialize");
    const emptyBeforeSeed = await firstWorker.request("get-summary");
    assertCount(emptyBeforeSeed.featureCount, 0, "A new worker database was not empty.");

    const seed = await firstWorker.request("seed-sample-data", {
      rowCount: SAMPLE_ROW_COUNT,
    });
    assertCount(
      seed.insertedFeatureCount,
      SAMPLE_ROW_COUNT,
      "The transactional sample insert returned an unexpected count.",
    );

    const populatedSummary = await firstWorker.request("get-summary");
    assertCount(populatedSummary.datasetCount, 1, "Expected one prototype dataset.");
    assertCount(
      populatedSummary.featureCount,
      SAMPLE_ROW_COUNT,
      "The populated database returned an unexpected feature count.",
    );

    const viewport = await firstWorker.request("query-viewport", {
      bounds: STOCKHOLM_BOUNDS,
      limit: 25,
    });
    assertCount(
      viewport.totalMatchingCount,
      10_000,
      "The Stockholm viewport query returned an unexpected match count.",
    );
    assertCount(viewport.returnedCount, 25, "The viewport limit was not applied.");

    const detail = await firstWorker.request("get-feature-detail", {
      datasetId: seed.datasetId,
      sourceRowIndex: 0,
    });
    if (!detail.found || detail.feature?.fields?.name !== "Prototype point 0") {
      throw new Error("The named detail query returned an unexpected feature.");
    }

    await firstWorker.request("close");
    firstWorkerClosed = true;
    firstWorker.terminate();

    const restart = await verifyFreshWorkerDatabase();

    return {
      sqliteVersion: initialization.sqliteVersion,
      databaseStorage: initialization.databaseStorage,
      workerType: initialization.workerType,
      crossOriginIsolated: initialization.crossOriginIsolated,
      sharedArrayBufferRequired: initialization.sharedArrayBufferRequired,
      namedOperations: [
        "initialize",
        "seed-sample-data",
        "get-summary",
        "query-viewport",
        "get-feature-detail",
        "close",
      ],
      sampleData: {
        datasetCount: populatedSummary.datasetCount,
        featureCount: populatedSummary.featureCount,
        transactionUsed: seed.transactionUsed,
      },
      viewport,
      detail,
      restart,
      timingsMs: {
        initialize: initialization.durationMs,
        insertTransaction: seed.durationMs,
        populatedSummary: populatedSummary.durationMs,
        viewportQuery: viewport.durationMs,
        detailQuery: detail.durationMs,
        restartInitialize: restart.initializeDurationMs,
        restartSummary: restart.summaryDurationMs,
      },
    };
  } finally {
    if (!firstWorkerClosed) {
      firstWorker.terminate();
    }
  }
}

async function verifyFreshWorkerDatabase() {
  const restartedWorker = createWorkerClient(showProgress);

  try {
    const initialization = await restartedWorker.request("initialize");
    const summary = await restartedWorker.request("get-summary");
    assertCount(
      summary.featureCount,
      0,
      "A restarted worker unexpectedly retained feature rows.",
    );
    assertCount(
      summary.datasetCount,
      0,
      "A restarted worker unexpectedly retained dataset rows.",
    );
    await restartedWorker.request("close");

    return {
      verifiedEmpty: true,
      datasetCount: summary.datasetCount,
      featureCount: summary.featureCount,
      initializeDurationMs: initialization.durationMs,
      summaryDurationMs: summary.durationMs,
    };
  } finally {
    restartedWorker.terminate();
  }
}

function createWorkerClient(onProgress) {
  const worker = new Worker(
    new URL("./compatibilityWorker.js", import.meta.url),
    { type: "module" },
  );
  const pendingRequests = new Map();
  let nextRequestId = 1;
  let terminated = false;

  worker.addEventListener("message", (event) => {
    const message = event.data;

    if (message?.type === "progress") {
      onProgress(message.stage ?? "unknown-stage");
      return;
    }

    if (message?.type !== "response") return;
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;

    globalThis.clearTimeout(pending.timeoutId);
    pendingRequests.delete(message.requestId);

    if (message.ok === true) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(
      message.error?.message ?? "SQLite WASM worker operation failed.",
    ));
  });

  worker.addEventListener("error", (event) => {
    rejectAllPending(
      new Error(event.message || "SQLite WASM worker failed to load."),
    );
  });

  function request(operation, payload = {}) {
    if (terminated) {
      return Promise.reject(new Error("The SQLite WASM worker is terminated."));
    }

    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(
          `SQLite WASM operation "${operation}" timed out after ${OPERATION_TIMEOUT_MS} ms.`,
        ));
      }, OPERATION_TIMEOUT_MS);

      pendingRequests.set(requestId, { resolve, reject, timeoutId });
      worker.postMessage({ requestId, operation, payload });
    });
  }

  function rejectAllPending(error) {
    pendingRequests.forEach((pending) => {
      globalThis.clearTimeout(pending.timeoutId);
      pending.reject(error);
    });
    pendingRequests.clear();
  }

  return {
    request,
    terminate() {
      if (terminated) return;
      terminated = true;
      worker.terminate();
      rejectAllPending(new Error("The SQLite WASM worker was terminated."));
    },
  };
}

function assertCount(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, received ${actual}.`);
  }
}

function showProgress(stage) {
  resultElement.textContent = `Worker stage: ${stage}`;
}

runSqliteWasmCompatibilityCheck()
  .then((result) => {
    resultElement.textContent = JSON.stringify(
      { status: "passed", ...result },
      null,
      2,
    );
    document.title = "PASS - SQLite WASM compatibility prototype";
  })
  .catch((error) => {
    resultElement.textContent = JSON.stringify({
      status: "failed",
      message: error?.message ? String(error.message) : String(error),
    }, null, 2);
    document.title = "FAIL - SQLite WASM compatibility prototype";
  });
