import { useEffect, useRef } from 'react';
import { createMapViewQueryScheduler } from './mapViewQueryScheduler.js';

/** Share the app's query lifecycle with renderer regression fixtures. */
export function useMapViewQuery({ dataSource, query, contextKey, playback, ready, onStateChange }) {
  const schedulerRef = useRef(null);

  useEffect(() => {
    if (!ready) return undefined;
    const scheduler = createMapViewQueryScheduler({
      queryMapView: (request) => dataSource.queryMapView(request),
      onStateChange,
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [dataSource, ready, onStateChange]);

  useEffect(() => {
    schedulerRef.current?.schedule({ query, contextKey, playback });
    // Keep an in-flight playback frame alive across ticks. Only the owner effect
    // disposes the scheduler on unmount, backend replacement or unavailability.
  }, [query, contextKey, playback, dataSource, ready, onStateChange]);
}
