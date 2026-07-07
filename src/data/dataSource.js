/**
 * Backend-neutral data source contract for map/viewer data.
 *
 * This module defines the app-facing boundary between the React/Leaflet UI and
 * whichever storage model provides the data. Implementations may be backed by
 * in-memory CSV rows, a local database, browser storage, or a remote service,
 * but callers should only depend on the viewer-oriented methods below.
 */

export const DATA_SOURCE_METHODS = Object.freeze({
  queryMapView: "queryMapView",
  getFeatureDetails: "getFeatureDetails",
  getGroupRows: "getGroupRows",
  getDatasetSummary: "getDatasetSummary",
});

/**
 * @typedef {object} DataSource
 * @property {(query: MapViewQuery) => MapViewResult | Promise<MapViewResult>} queryMapView
 *   Returns compact map render data for the current viewer state.
 * @property {(query: FeatureDetailsQuery) => FeatureDetailsResult | Promise<FeatureDetailsResult>} getFeatureDetails
 *   Returns row/detail data for a selected map feature.
 * @property {(query: GroupRowsQuery) => GroupRowsResult | Promise<GroupRowsResult>} getGroupRows
 *   Returns a page of backing rows for a dataset or future grouped detail view.
 * @property {() => DatasetSummary | Promise<DatasetSummary>} getDatasetSummary
 *   Returns dataset metadata and summary information needed by the UI.
 */

/**
 * @typedef {object} MapViewQuery
 * @property {MapBounds|null} [bounds]
 *   Current map bounds. Implementations may ignore this when they cannot query
 *   spatially yet, but future indexed backends should use it to limit work.
 * @property {number|null} [zoom]
 *   Current map zoom level.
 * @property {TimelineFilter|null} [timeline]
 *   Current timeline filter state in app terms.
 * @property {number|null} [renderBudget]
 *   Soft maximum number of render items the caller wants back.
 */

/**
 * @typedef {object} MapBounds
 * @property {number} north
 * @property {number} south
 * @property {number} east
 * @property {number} west
 */

/**
 * @typedef {object} TimelineFilter
 * @property {boolean} [timelineEnabled]
 * @property {number|null} [startYear]
 * @property {number|null} [endYear]
 * @property {number|null} [yearMin]
 * @property {number|null} [yearMax]
 */

/**
 * @typedef {object} MapViewResult
 * @property {PointFeature[]} points
 * @property {LineFeature[]} lines
 * @property {RegionFeature[]} regions
 * @property {MapViewStats} stats
 * @property {TimelineIndex} timelineIndex
 */

/**
 * @typedef {object} PointFeature
 * @property {string} id
 * @property {number} lat
 * @property {number} lon
 * @property {FeatureSourceRef|null} [sourceRef]
 * @property {string|null} [marker]
 * @property {string|null} [image]
 * @property {number|null} [imageWidthMeters]
 * @property {number|null} [imageHeightMeters]
 * @property {string|null} [latField]
 * @property {string|null} [lonField]
 */

/**
 * @typedef {object} LineFeature
 * @property {string} id
 * @property {string|null} [featureId]
 * @property {Array<[number, number]>} coordinates
 * @property {object|null} [style]
 * @property {"none"|"start"|"end"|"both"|null} [arrow]
 * @property {FeatureSourceRef|null} [sourceRef]
 * @property {string|null} [latField]
 * @property {string|null} [lonField]
 */

/**
 * @typedef {object} RegionFeature
 * @property {string} id
 * @property {string|null} [featureId]
 * @property {string|null} [part]
 * @property {Array<[number, number]>} coordinates
 * @property {object|null} [style]
 * @property {FeatureSourceRef|null} [sourceRef]
 * @property {string|null} [latField]
 * @property {string|null} [lonField]
 */

/**
 * @typedef {object} FeatureSourceRef
 * @property {string} datasetId
 * @property {number} rowIndex
 */

/**
 * @typedef {object} MapViewStats
 * @property {number} skippedPoints
 * @property {number} skippedLines
 * @property {number} skippedRegions
 * @property {number} skippedPointsByTimeline
 * @property {number} skippedLinesByTimeline
 * @property {number} skippedRegionsByTimeline
 * @property {number} skippedByTimeline
 * @property {number|null} [limitedToRenderBudget]
 */

/**
 * @typedef {object} TimelineIndex
 * @property {TimelineIndexEntry[]} entries
 */

/**
 * @typedef {object} TimelineIndexEntry
 * @property {string} featureId
 * @property {number} startYear
 * @property {number} endYear
 */

/**
 * @typedef {object} FeatureDetailsQuery
 * @property {string|null} [featureId]
 * @property {FeatureSourceRef|null} [sourceRef]
 */

/**
 * @typedef {object} FeatureDetailsResult
 * @property {string|null} featureId
 * @property {Record<string, string>|null} row
 * @property {string|null} [latField]
 * @property {string|null} [lonField]
 */

/**
 * @typedef {object} GroupRowsQuery
 * @property {string|null} [datasetId]
 * @property {string|null} [groupId]
 * @property {number} [offset]
 * @property {number} [limit]
 */

/**
 * @typedef {object} GroupRowsResult
 * @property {Record<string, string>[]} rows
 * @property {number} offset
 * @property {number} limit
 * @property {number|null} totalRows
 */

/**
 * @typedef {object} DatasetSummary
 * @property {DatasetSummaryItem[]} datasets
 * @property {TimelineSummary|null} timeline
 */

/**
 * @typedef {object} DatasetSummaryItem
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {string[]} headers
 * @property {number} rowCount
 * @property {number} totalRows
 * @property {string|null} latField
 * @property {string|null} lonField
 * @property {string[]} parseErrors
 */

/**
 * @typedef {object} TimelineSummary
 * @property {number|null} yearMin
 * @property {number|null} yearMax
 */
