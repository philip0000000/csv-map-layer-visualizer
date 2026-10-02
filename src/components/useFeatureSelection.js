import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_GROUP_ROWS_LIMIT } from '../data/dataSource';
import { applyCommittedZoneToSelection, refreshSelectionGroupRef, selectionMatchesTimeline, selectionTimelineKey } from './featureSelection';

/** Own one panel selection independently of viewport updates and lazy detail-loading outcomes. */
export function useFeatureSelection({ dataSource, datasets, timeline }) {
  const [selection, setSelection] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const timelineKey = selectionTimelineKey(timeline);
  const enabledIdsKey = JSON.stringify(datasets.filter((item) => item.enabled).map((item) => item.id));

  /** Replace selection immediately and share its single lazy source-row request with the panel. */
  const selectFeature = useCallback((feature, nearbyMarkers = []) => {
    const request = !feature.groupRef && feature.sourceRef
      ? Promise.resolve().then(() => dataSource.getFeatureDetails({
        featureId: feature.id, sourceRef: feature.sourceRef,
      })) : null;
    // A closed panel may never consume this request. Its rejection is still shown by an open panel.
    request?.catch(() => {});
    setSelection({ feature, nearbyMarkers, request, groupPage: null, groupError: null });
    setIsCollapsed(false);
  }, [dataSource]);

  /** Closing clears both details and the shared map/editor selection. */
  const close = useCallback(() => {
    setSelection(null);
    setIsCollapsed(false);
  }, []);

  const feature = selection?.feature;
  /** Keep the viewport-independent highlight synchronized with a successful zone commit. */
  const applyCommittedZone = useCallback((zone) => {
    setSelection((current) => applyCommittedZoneToSelection(current, zone));
  }, []);
  const source = feature?.sourceRef;
  const request = selection?.request;
  // Reuse the selected request; expanding other nearby rows still uses the normal backend API.
  const getFeatureDetails = useCallback((query) => {
    return request && source?.datasetId === query.sourceRef?.datasetId
      && source?.rowIndex === query.sourceRef?.rowIndex
      ? request : dataSource.getFeatureDetails(query);
  }, [dataSource, source, request]);

  const originalGroupRef = feature?.groupRef;
  const groupRef = useMemo(() => originalGroupRef
    ? refreshSelectionGroupRef(originalGroupRef, JSON.parse(enabledIdsKey), timelineKey)
    : null, [originalGroupRef, enabledIdsKey, timelineKey]);
  const groupPage = selection?.groupPage;
  const confirmedGroupKey = JSON.stringify(groupPage?.groupRef ?? originalGroupRef);
  const requestedGroupKey = JSON.stringify(groupRef);

  useEffect(() => {
    if (!groupRef?.datasetIds.length || confirmedGroupKey === requestedGroupKey) return;
    let obsolete = false;
    // Keep the previous group visible until its new count and first page are confirmed together.
    Promise.resolve().then(() => dataSource.getGroupRows({
      groupRef, offset: 0, limit: DEFAULT_GROUP_ROWS_LIMIT,
    })).then((result) => {
      if (obsolete) return;
      setSelection((current) => {
        if (current?.feature !== feature) return current;
        if (result.totalRows === 0) return null;
        return { ...current, groupPage: { groupRef, result }, groupError: null };
      });
    }).catch(() => {
      if (obsolete) return;
      // A failed refresh is not evidence that the group is empty; retain it and explain the failure.
      setSelection((current) => current?.feature === feature
        ? { ...current, groupError: {
          filterKey: requestedGroupKey,
          message: 'Could not refresh grouped markers for the current filters.',
        } }
        : current);
    });
    return () => { obsolete = true; };
  }, [dataSource, feature, groupRef, confirmedGroupKey, requestedGroupKey]);

  /** Reuse the refresh's first page; later pages keep using the confirmed group reference. */
  const getGroupRows = useCallback((query) => {
    if (groupPage && query.groupRef === groupPage.groupRef
      && (query.offset ?? 0) === 0 && (query.limit ?? DEFAULT_GROUP_ROWS_LIMIT) === DEFAULT_GROUP_ROWS_LIMIT) {
      return Promise.resolve(groupPage.result);
    }
    return dataSource.getGroupRows(query);
  }, [dataSource, groupPage]);

  const datasetEnabled = (point) => !point.sourceRef
    || datasets.some((item) => item.id === point.sourceRef.datasetId && item.enabled);
  const available = !!feature && (groupRef
    ? groupRef.datasetIds.length > 0
    : datasetEnabled(feature) && selectionMatchesTimeline(feature, timeline));

  // Discard invalid selections during reconciliation so changing filters back cannot revive them.
  if (selection && !available) setSelection(null);

  // Stored bounds let matching nearby markers survive filter changes without loading their rows.
  const nearbyMarkers = available ? selection.nearbyMarkers.filter((point) =>
    datasetEnabled(point) && selectionMatchesTimeline(point, timeline)) : [];
  const selectedFeature = !available ? null : groupPage
    ? { ...feature, groupRef: groupPage.groupRef, count: groupPage.result.totalRows }
    : feature;

  return {
    selectedFeature,
    nearbyMarkers,
    getFeatureDetails,
    getGroupRows,
    // An error from another filter must not follow the user back to a confirmed snapshot.
    groupRefreshError: available && selection.groupError?.filterKey === requestedGroupKey
      ? selection.groupError.message : null,
    selectFeature,
    applyCommittedZone,
    close,
    isCollapsed,
    toggleCollapse: () => setIsCollapsed((value) => !value),
  };
}
