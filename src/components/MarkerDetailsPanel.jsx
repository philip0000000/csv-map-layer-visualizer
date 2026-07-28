import { useEffect, useRef, useState } from 'react';

import {
  GroupedMarkerDetails,
  NearbyMarkerDetails,
  PointMarkerDetails,
} from './MarkerDetails';

const DEFAULT_PANEL_WIDTH = 360;
const MIN_PANEL_WIDTH = 280;
const COLLAPSED_PANEL_WIDTH = 34;

export function MarkerDetailsPanel({
  marker,
  markers = [],
  leftOffset,
  getSourceRow,
  getFeatureDetails,
  getGroupRows,
  isCollapsed,
  onToggleCollapse,
  onClose,
}) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const panelRef = useRef(null);

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

  if (!marker) return null;

  const grouped = isGroupedMarker(marker);
  const showsProximityResults = !grouped && markers.length > 1;
  // Remount details when selection changes so old loading/paging state cannot leak.
  const detailKey = showsProximityResults
    ? `nearby:${marker.id}:${markers.length}`
    : `${marker.renderType ?? 'exact'}:${marker.id}`;

  return (
    <aside
      ref={panelRef}
      className='markerDetailsPanel'
      style={{
        left: leftOffset,
        width: isCollapsed ? COLLAPSED_PANEL_WIDTH : panelWidth,
        maxWidth: `calc(100vw - ${leftOffset}px)`,
      }}
      aria-label='Marker details'
    >
      {/* Keep Close visible while the remaining collapsed rail expands. */}
      <button
        type='button'
        className='markerDetailsPanelClose markerDetailsPanelCollapsedClose'
        onClick={onClose}
        aria-label='Close marker details'
        title='Close'
        hidden={!isCollapsed}
      >
        &times;
      </button>
      <button
        type='button'
        className='markerDetailsPanelExpandRail'
        onClick={onToggleCollapse}
        aria-label='Expand marker details'
        title='Expand marker details'
        hidden={!isCollapsed}
      />

      <div className='markerDetailsPanelHeader' hidden={isCollapsed}>
        <div className='markerDetailsPanelHeaderActions'>
          <button
            type='button'
            className='markerDetailsPanelCollapse'
            onClick={onToggleCollapse}
            aria-label='Collapse marker details'
            title='Collapse'
          >
            &lt;
          </button>
          <button
            type='button'
            className='markerDetailsPanelClose'
            onClick={onClose}
            aria-label='Close marker details'
            title='Close'
          >
            ×
          </button>
        </div>
      </div>

      {/* hidden keeps detail state mounted while the panel is collapsed. */}
      <div className='markerDetailsPanelContent' hidden={isCollapsed}>
        {showsProximityResults ? (
          <NearbyMarkerDetails
            key={detailKey}
            points={markers}
            getSourceRow={getSourceRow}
            getFeatureDetails={getFeatureDetails}
          />
        ) : grouped ? (
          <GroupedMarkerDetails
            key={detailKey}
            point={marker}
            getGroupRows={getGroupRows}
            isActive
          />
        ) : (
          <PointMarkerDetails
            key={detailKey}
            point={marker}
            latField={marker.latField}
            lonField={marker.lonField}
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
        aria-label='Resize marker details panel'
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

function isGroupedMarker(marker) {
  return marker?.renderType === 'grouped' ||
    marker?.renderType === 'representative';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
