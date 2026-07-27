import { useEffect, useMemo, useRef, useState } from 'react';
import { selectRuntimeDataSource } from '../data/runtimeDataSource.js';

/** Own the one selected backend for the lifetime of the current page session. */
export function useRuntimeDataSource() {
  const desktopApi = useMemo(() => globalThis.csvMapDesktop ?? null, []);
  // Vite resolves this development/test flag at build time. Reading it once
  // here prevents backend switching after a session has begun importing data.
  const browserBackend = useMemo(
    () => import.meta.env.VITE_BROWSER_DATA_BACKEND ?? 'raw',
    [],
  );
  const [dataRevision, setDataRevision] = useState(0);
  const disposeTimerRef = useRef(null);
  const selection = useMemo(() => selectRuntimeDataSource({
    desktopApi,
    browserBackend,
    onBrowserStateChange: () => {
      setDataRevision((current) => current + 1);
    },
  }), [browserBackend, desktopApi]);
  const [initialization, setInitialization] = useState(null);

  useEffect(() => {
    const pendingDisposal = disposeTimerRef.current;
    if (pendingDisposal?.dataSource === selection.dataSource) {
      globalThis.clearTimeout(pendingDisposal.timerId);
      disposeTimerRef.current = null;
    }

    let canceled = false;
    Promise.resolve(selection.dataSource.initialize())
      .then((result) => {
        if (!canceled) setInitialization(result);
      })
      .catch((error) => {
        if (!canceled) {
          setInitialization({
            ok: false,
            capabilities: selection.capabilities,
            error: {
              message: error?.message
                ? String(error.message)
                : 'The selected data backend could not be initialized.',
            },
          });
        }
      });

    return () => {
      canceled = true;
      const timerId = globalThis.setTimeout(() => {
        selection.dataSource.dispose();
      }, 0);
      disposeTimerRef.current = {
        dataSource: selection.dataSource,
        timerId,
      };
    };
  }, [selection]);

  return {
    ...selection,
    initialization,
    dataRevision,
    workflow: Object.freeze({
      rawBrowserFiles: selection.runtime === 'browser',
      browserFiles: selection.capabilities.browserFileImport,
      viewportQueries: selection.capabilities.groupedViewportResults,
    }),
  };
}
