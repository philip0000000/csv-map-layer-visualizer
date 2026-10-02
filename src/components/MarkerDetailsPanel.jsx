import { featureSelectionKey } from './featureSelection';
import { useEffect, useRef, useState } from 'react';
import { getFeatureNavigationTarget } from './featureMapNavigation';

import {
  GroupedMarkerDetails,
  NearbyMarkerDetails,
  FeatureDetails,
} from './MarkerDetails';

const DEFAULT_PANEL_WIDTH = 360;
const MIN_PANEL_WIDTH = 280;
const COLLAPSED_PANEL_WIDTH = 34;

/** Share panel layout and controls across point, line, and logical-zone selections. */
export function MarkerDetailsPanel({
  feature,
  dataSource,
  navigationRevision,
  onNavigate,
  nearbyMarkers = [],
  leftOffset,
  getSourceRow,
  getFeatureDetails,
  getGroupRows,
  refreshError,
  isCollapsed,
  onToggleCollapse,
  onClose,
}) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const panelRef = useRef(null);
  const navigationRequest = useRef(0);
  const navigationKey = `${featureSelectionKey(feature)}:${navigationRevision}:${isCollapsed}`;
  const [navigationState, setNavigationState] = useState({ key: null, pending: false, error: null });
  const currentNavigation = navigationState.key === navigationKey ? navigationState : {};

  // Closing, collapsing, editing, or changing filters invalidates pending geometry.
  useEffect(() => {
    navigationRequest.current += 1;
    return () => { navigationRequest.current += 1; };
  }, [navigationKey]);

  /** Resolve fresh geometry; stale responses must never move the map. */
  async function viewOnMap() {
    const request = ++navigationRequest.current;
    setNavigationState({ key: navigationKey, pending: true, error: null });
    try {
      const target = await getFeatureNavigationTarget(dataSource, feature);
      if (request !== navigationRequest.current) return;
      onNavigate(target, panelRef.current.getBoundingClientRect().right);
      setNavigationState({ key: navigationKey, pending: false, error: null });
    } catch (error) {
      if (request !== navigationRequest.current) return;
      setNavigationState({ key: navigationKey, pending: false, error: error.message || 'Unable to view this feature on the map.' });
    }
  }

  // Drag values live outside render so window-level mouse events stay stable.
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startWidth: DEFAULT_PANEL_WIDTH,
  });

  useEffect(() => {
    const dragState = dragRef.current;

    function handleMouseMove(event) {
      if (!dragState.dragging) return;

      // The panel may use only the viewport space remaining after the CSV panel.
      const maxWidth = Math.max(0, window.innerWidth - leftOffset);
      const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
      const deltaX = event.clientX - dragState.startX;

      setPanelWidth(clamp(
        dragState.startWidth + deltaX,
        minWidth,
        maxWidth,
      ));
    }

    function handleMouseUp() {
      dragState.dragging = false;
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      dragState.dragging = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftOffset]);

  if (!feature) return null;

  const grouped = isGroupedMarker(feature);
  const showsProximityResults = !grouped && (!feature.selectionKind || feature.selectionKind === 'point')
    && nearbyMarkers.length > 1;
  // Remount details when selection changes so old loading/paging state cannot leak.
  const detailKey = showsProximityResults
    ? `nearby:${featureSelectionKey(feature)}:${nearbyMarkers.map((point) => featureSelectionKey(point)).join('|')}`
    : `${feature.renderType ?? 'exact'}:${featureSelectionKey(feature)}`;

  return (
    <aside
      ref={panelRef}
      className='markerDetailsPanel'
      style={{
        left: leftOffset,
        width: isCollapsed ? COLLAPSED_PANEL_WIDTH : panelWidth,
        maxWidth: `calc(100vw - ${leftOffset}px)`,
      }}
      aria-label='Feature details'
    >
      {/* Keep Close visible while the remaining collapsed rail expands. */}
      <button
        type='button'
        className='markerDetailsPanelClose markerDetailsPanelCollapsedClose'
        onClick={onClose}
        aria-label='Close feature details'
        title='Close'
        hidden={!isCollapsed}
      >
        &times;
      </button>
      <button
        type='button'
        className='markerDetailsPanelExpandRail'
        onClick={onToggleCollapse}
        aria-label='Expand feature details'
        title='Expand feature details'
        hidden={!isCollapsed}
      />

      <div className='markerDetailsPanelHeader' hidden={isCollapsed}>
        <div className='markerDetailsPanelHeaderActions'>
          <button
            type='button'
            className='markerDetailsPanelCollapse'
            onClick={viewOnMap}
            disabled={!!currentNavigation.pending}
            aria-label='View on map'
            title='View on map'
          >
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
              <circle cx='12' cy='12' r='6' />
              <path d='M12 2v5m0 10v5M2 12h5m10 0h5' />
            </svg>
          </button>
          <button
            type='button'
            className='markerDetailsPanelCollapse'
            onClick={onToggleCollapse}
            aria-label='Collapse feature details'
            title='Collapse'
          >
            &lt;
          </button>
          <button
            type='button'
            className='markerDetailsPanelClose'
            onClick={onClose}
            aria-label='Close feature details'
            title='Close'
          >
            ×
          </button>
        </div>
      </div>

      {/* hidden keeps detail state mounted while the panel is collapsed. */}
      <div className='markerDetailsPanelContent' hidden={isCollapsed}>
        {currentNavigation.error && <div role='alert'>{currentNavigation.error}</div>}
        {refreshError && <div role='status'>{refreshError}</div>}
        {showsProximityResults ? (
          <NearbyMarkerDetails
            key={detailKey}
            points={nearbyMarkers}
            getSourceRow={getSourceRow}
            getFeatureDetails={getFeatureDetails}
          />
        ) : grouped ? (
          <GroupedMarkerDetails
            key={detailKey}
            point={feature}
            getGroupRows={getGroupRows}
            isActive
          />
        ) : (
          <FeatureDetails
            key={detailKey}
            feature={feature}
            kind={feature.selectionKind}
            latField={feature.latField}
            lonField={feature.lonField}
            getSourceRow={getSourceRow}
            getFeatureDetails={getFeatureDetails}
            isActive
          />
        )}
      </div>

      <div
        className='markerDetailsPanelDivider'
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize feature details panel'
        hidden={isCollapsed}
        onMouseDown={(event) => {
          event.preventDefault();
          dragRef.current.dragging = true;
          dragRef.current.startX = event.clientX;
          dragRef.current.startWidth =
            panelRef.current?.getBoundingClientRect().width ?? panelWidth;
        }}
      />
    </aside>
  );
}

function isGroupedMarker(feature) {
  return feature?.renderType === 'grouped' ||
    feature?.renderType === 'representative';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
