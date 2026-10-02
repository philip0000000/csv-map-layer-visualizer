import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { selectionMatchesTimeline, selectionTimelineKey } from '../featureSelection.js';

/** Resolve on open and again on activation so stale filters cannot select a hidden feature. */
export function usePreviewRowMenu({ dataSource, files, timeline, revision, onFeatureSelect }) {
  const [menu, setMenu] = useState(null);
  const sequence = useRef(0);
  const element = useRef(null);
  const filterKey = JSON.stringify([revision, selectionTimelineKey(timeline), files.map((f) => [f.id, f.enabled])]);
  if (menu && menu.filterKey !== filterKey) setMenu(null);
  const menuOpen = !!menu && menu.filterKey === filterKey;

  useEffect(() => {
    sequence.current += 1;
    return () => { sequence.current += 1; };
  }, [filterKey]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    element.current?.focus();
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && element.current?.contains(event.target)) return;
      sequence.current += 1;
      setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [menuOpen]);

  /** Explain unavailable rows without changing file visibility or timeline filters. */
  async function resolve(sourceRef) {
    if (!files.some((f) => f.id === sourceRef.datasetId && f.enabled)) return { reason: 'This file is hidden on the map.' };
    const feature = await dataSource.getPreviewFeature({ sourceRef });
    if (!feature) return { reason: 'This row has no map feature.' };
    if (!selectionMatchesTimeline(feature, timeline)) return { reason: 'This feature is hidden by the timeline.' };
    return { feature };
  }

  /** Open a compact menu and ignore a lookup superseded by another row or filter. */
  async function open(event, sourceRef) {
    event.preventDefault();
    const request = ++sequence.current;
    const position = { filterKey, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 270)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight - 130)), sourceRef };
    setMenu({ ...position, reason: 'Checking map feature…' });
    try {
      const result = await resolve(sourceRef);
      if (sequence.current === request) setMenu({ ...position, ...result });
    } catch {
      if (sequence.current === request) setMenu({ ...position, reason: 'Could not load this map feature.' });
    }
  }

  /** Use the same shared selection callback as map clicks, without navigation. */
  async function highlight() {
    const request = ++sequence.current;
    const current = menu;
    setMenu({ ...current, feature: null, reason: 'Checking map feature…' });
    try {
      const result = await resolve(current.sourceRef);
      if (sequence.current !== request) return;
      if (result.feature) { onFeatureSelect(result.feature); setMenu(null); }
      else setMenu({ ...current, ...result, feature: null });
    } catch {
      if (sequence.current === request) setMenu({ ...current, feature: null, reason: 'Could not load this map feature.' });
    }
  }

  const overlay = menu && createPortal(<div className="csvPreviewRowMenu" ref={element} tabIndex={-1}
    role="menu" aria-label="Preview row actions" style={{ left: menu.x, top: menu.y }}>
    <button type="button" role="menuitem" disabled={!menu.feature} onClick={highlight}>Highlight on map</button>
    {menu.reason && <div role="status">{menu.reason}</div>}
  </div>, document.body);
  return { open, overlay };
}
