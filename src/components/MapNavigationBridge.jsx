import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { navigateToFeature } from './featureMapNavigation';

/** Expose explicit map navigation while leaving selection behavior unchanged. */
export function MapNavigationBridge({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady?.((target, panelRight) => navigateToFeature(map, target, panelRight));
    return () => onReady?.(null);
  }, [map, onReady]);
  return null;
}
