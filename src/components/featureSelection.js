/** Identify a logical selection without confusing datasets, types, or zone parts. */
export function featureSelectionKey(feature, kind = feature?.selectionKind ?? 'point') {
  if (!feature) return null;
  if (feature.groupRef) return JSON.stringify([kind, feature.id, feature.groupRef]);
  return JSON.stringify([
    kind,
    feature.sourceRef?.datasetId ?? feature.sourceFileId ?? null,
    kind === 'region' ? feature.featureId ?? feature.id : feature.id,
  ]);
}

/** Compare rendered geometry to the shared selection, including every part of a zone. */
export function isFeatureSelected(feature, kind, selectedFeature) {
  return !!selectedFeature && featureSelectionKey(feature, kind) === featureSelectionKey(selectedFeature);
}

/** Capture only the inclusive year filter currently implemented by both SQLite backends. */
export function selectionTimelineKey(timeline) {
  if (!timeline?.timelineEnabled || timeline.startYear == null || timeline.endYear == null) return 'all';
  return JSON.stringify([
    Math.min(timeline.startYear, timeline.endYear),
    Math.max(timeline.startYear, timeline.endYear),
  ]);
}

/** Match the backend's stored bounds without depending on detail loading or reparsing CSV. */
export function selectionMatchesTimeline(feature, timeline) {
  if (selectionTimelineKey(timeline) === 'all') return true;
  const extent = feature?.timelineExtent;
  return extent?.startYear != null && extent?.endYear != null
    && extent.startYear <= Math.max(timeline.startYear, timeline.endYear)
    && extent.endYear >= Math.min(timeline.startYear, timeline.endYear);
}

/** Refresh filters for the same captured group cell without following viewport regrouping. */
export function refreshSelectionGroupRef(groupRef, enabledDatasetIds, timelineKey) {
  const range = timelineKey === 'all' ? null : JSON.parse(timelineKey);
  return {
    ...groupRef,
    datasetIds: groupRef.datasetIds.filter((id) => enabledDatasetIds.includes(id)),
    timeline: range ? { timelineEnabled: true, startYear: range[0], endYear: range[1] } : null,
  };
}

/** Apply a matching edit preview to one region already admitted by the current map query. */
export function getDisplayedRegion(region, selectedFeature, selectedZone, previewParts) {
  if (!isFeatureSelected(region, 'region', selectedFeature)
    || selectedZone?.datasetId !== region.sourceRef?.datasetId
    || selectedZone?.featureId !== region.featureId) return region;
  const part = (previewParts ?? selectedZone.parts).find((item) => item.part === region.part);
  return part ? { ...region, coordinates: part.coordinates, style: part.style } : region;
}
