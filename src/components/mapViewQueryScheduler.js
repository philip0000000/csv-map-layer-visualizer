/** Schedule viewport queries without starving fast heatmap playback frames. */
export function createMapViewQueryScheduler({ queryMapView, onStateChange }) {
  let latest = null;
  let pending = null;
  let running = false;
  let timer = null;
  let disposed = false;
  let sequence = 0;

  /** Report query activity while retaining the last completed map result. */
  function reportLoading() {
    onStateChange((current) => ({
      ...current,
      status: current.result ? 'refreshing' : 'loading',
      error: null,
    }));
  }

  /** Render completed playback frames only while their datasets and viewport still match. */
  function canPublish(request) {
    return !disposed && latest && (
      request.sequence === latest.sequence || (
        request.playback && latest.playback
        && request.contextKey === latest.contextKey
        && request.viewportKey === latest.viewportKey
      )
    );
  }

  /** Run one request; intermediate playback ticks replace only the pending request. */
  function pump() {
    if (disposed || running || !pending?.ready) return;
    const request = pending;
    pending = null;
    running = true;
    reportLoading();
    // Resolve synchronous failures through the same cleanup path as async queries.
    Promise.resolve().then(() => queryMapView(request.query)).then((result) => {
      if (canPublish(request)) {
        onStateChange({ status: 'loaded', result, error: null, heatContextKey: request.contextKey });
      }
    }).catch((error) => {
      // An obsolete frame's failure must not replace the newest pending frame.
      if (!disposed && request.sequence === latest?.sequence) {
        onStateChange((current) => ({ ...current, status: 'error',
          error: error?.message ? String(error.message) : 'Map query failed.' }));
      }
    }).finally(() => {
      running = false;
      pump();
    });
  }

  return {
    /** Debounce manual navigation; start playback immediately and coalesce busy ticks. */
    schedule({ query, contextKey, playback = false }) {
      if (disposed) return;
      globalThis.clearTimeout(timer);
      latest = {
        query, contextKey, playback,
        viewportKey: JSON.stringify([query.bounds, query.zoom]),
        sequence: ++sequence,
        ready: playback,
      };
      pending = latest;
      reportLoading();
      if (playback) {
        pump();
      } else {
        timer = globalThis.setTimeout(() => {
          if (pending) pending.ready = true;
          pump();
        }, 100);
      }
    },
    /** Drop pending work and ignore in-flight results when the map becomes unavailable. */
    dispose() {
      disposed = true;
      globalThis.clearTimeout(timer);
      pending = null;
      latest = null;
    },
  };
}
