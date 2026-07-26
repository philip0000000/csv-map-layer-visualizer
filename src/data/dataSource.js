/**
 * Backend-neutral data source contract for map/viewer data.
 *
 * This module defines the app-facing boundary between the React/Leaflet UI and
 * whichever storage model provides the data. Implementations may be backed by
 * in-memory CSV rows, a local database, browser storage, or a remote service,
 * but callers should only depend on the viewer-oriented methods below.
 */

/** Complete operation surface implemented by the selected session backend. */
export const DATA_SOURCE_METHODS = Object.freeze({
  initialize: "initialize",
  getCapabilities: "getCapabilities",
  importBrowserFiles: "importBrowserFiles",
  importFromPicker: "importFromPicker",
  importDroppedFiles: "importDroppedFiles",
  importExample: "importExample",
  subscribeImportProgress: "subscribeImportProgress",
  cancelImport: "cancelImport",
  getDatasetSummary: "getDatasetSummary",
  selectDataset: "selectDataset",
  setDatasetEnabled: "setDatasetEnabled",
  removeDataset: "removeDataset",
  updateDatasetMapping: "updateDatasetMapping",
  getPreviewPage: "getPreviewPage",
  queryMapView: "queryMapView",
  getFeatureDetails: "getFeatureDetails",
  getGroupRows: "getGroupRows",
  dispose: "dispose",
});

/** Default grouped-marker detail page size. */
export const DEFAULT_GROUP_ROWS_LIMIT = 30;
/** Default source preview page size; intentionally separate from group paging. */
export const DEFAULT_PREVIEW_ROWS_LIMIT = 30;

/** Stable public failure categories used at every adapter boundary. */
export const BACKEND_FAILURE_CATEGORIES = Object.freeze({
  BACKEND_UNAVAILABLE: "backend-unavailable",
  INITIALIZATION_FAILED: "initialization-failed",
  IMPORT_FAILED: "import-failed",
  IMPORT_CANCELED: "import-canceled",
  INVALID_MAPPING: "invalid-mapping",
  DATASET_NOT_FOUND: "dataset-not-found",
  QUERY_FAILED: "query-failed",
});

/**
 * @typedef {"backend-unavailable"|"initialization-failed"|"import-failed"|"import-canceled"|"invalid-mapping"|"dataset-not-found"|"query-failed"} BackendFailureCategory
 */

/**
 * @typedef {object} DataSource
 * @property {() => InitializationResult | Promise<InitializationResult>} initialize
 *   Initializes this backend once for the current page session. Repeated calls
 *   must be safe and must not activate another backend.
 * @property {() => BackendCapabilities} getCapabilities
 *   Returns immutable capability facts. Presentation components should consume
 *   controller decisions rather than branch on backend identities.
 * @property {(request: BrowserFileImportRequest) => ImportBatchResult | Promise<ImportBatchResult>} importBrowserFiles
 *   Imports browser-provided `File` objects. Unsupported backends return or
 *   reject with a normalized backend-unavailable failure.
 * @property {(request?: PickerImportRequest) => ImportBatchResult | Promise<ImportBatchResult>} importFromPicker
 *   Requests a backend-owned native picker. It must not expose filesystem paths
 *   to shared UI code.
 * @property {(request: DroppedFileImportRequest) => ImportBatchResult | Promise<ImportBatchResult>} importDroppedFiles
 *   Imports dropped renderer-safe file handles. Desktop path extraction remains
 *   inside the preload/main-process security boundary.
 * @property {(request: ExampleImportRequest) => ImportBatchResult | Promise<ImportBatchResult>} importExample
 *   Imports one bundled example identified by a validated relative name.
 * @property {(listener: ImportProgressListener) => DataSourceUnsubscribe} subscribeImportProgress
 *   Subscribes to normalized progress and returns an idempotent cleanup callback.
 * @property {(importId: string) => ImportCancellationResult | Promise<ImportCancellationResult>} cancelImport
 *   Requests cancellation. Capabilities state when active cancellation is unavailable.
 * @property {() => DatasetSummary | Promise<DatasetSummary>} getDatasetSummary
 *   Returns dataset metadata and summary information needed by the UI.
 * @property {(datasetId: string|null) => DatasetMutationResult | Promise<DatasetMutationResult>} selectDataset
 *   Updates session selection. Implementations must not imply persistence unless
 *   their capabilities explicitly say selection is persistent.
 * @property {(datasetId: string, enabled: boolean) => DatasetMutationResult | Promise<DatasetMutationResult>} setDatasetEnabled
 *   Enables or disables one dataset.
 * @property {(datasetId: string) => DatasetMutationResult | Promise<DatasetMutationResult>} removeDataset
 *   Removes one dataset from the active backend without modifying its source file.
 * @property {(datasetId: string, mapping: CoordinateMapping) => MappingMutationResult | Promise<MappingMutationResult>} updateDatasetMapping
 *   Changes coordinate fields and returns normalized detected timeline metadata.
 * @property {(query: PreviewPageQuery) => PreviewPageResult | Promise<PreviewPageResult>} getPreviewPage
 *   Returns source rows in original file order. Preview paging is independent
 *   from grouped-marker paging.
 * @property {(query: MapViewQuery) => MapViewResult | Promise<MapViewResult>} queryMapView
 *   Returns compact map render data for the current viewer state.
 * @property {(query: FeatureDetailsQuery) => FeatureDetailsResult | Promise<FeatureDetailsResult>} getFeatureDetails
 *   Returns row/detail data for a selected map feature.
 * @property {(query: GroupRowsQuery) => GroupRowsResult | Promise<GroupRowsResult>} getGroupRows
 *   Returns a page of backing rows for a dataset or future grouped detail view.
 * @property {() => void | Promise<void>} dispose
 *   Releases listeners, workers, and backend resources. It must be idempotent.
 */

/**
 * Every page session selects and initializes exactly one DataSource. All
 * operations use the success shapes below. Failures must be converted at the
 * adapter boundary to BackendFailure before they reach presentation code.
 * Unsupported operations use the backend-unavailable category; callers should
 * not inspect runtime APIs or backend implementation details. Synchronous
 * operations throw and asynchronous operations reject with BackendFailure for
 * operation-wide failures. Results with expected partial outcomes, such as
 * imports and mutations, carry their normalized `error` field instead.
 *
 * @typedef {object} BackendFailure
 * @property {BackendFailureCategory} category
 * @property {string} message
 *   Safe user-facing message without paths, SQL, IPC names, or worker internals.
 * @property {string} operation
 * @property {boolean} recoverable
 * @property {string|null} [datasetId]
 * @property {string|null} [importId]
 */

/**
 * @typedef {object} InitializationResult
 * @property {boolean} ok
 * @property {BackendCapabilities} capabilities
 * @property {BackendFailure|null} error
 */

/**
 * Real behavior supported by the selected backend. Capability checks belong in
 * the shared controller so they do not become scattered backend identity checks.
 *
 * @typedef {object} BackendCapabilities
 * @property {"temporary"|"persistent"} persistence
 * @property {boolean} browserFileImport
 * @property {boolean} nativeFilePickerImport
 * @property {boolean} droppedFileImport
 * @property {boolean} exampleImport
 * @property {boolean} multipleFileImport
 * @property {boolean} importProgress
 * @property {boolean} importCancellation
 * @property {boolean} datasetSelection
 * @property {boolean} datasetVisibility
 * @property {boolean} datasetRemoval
 * @property {boolean} datasetMapping
 * @property {boolean} previewPaging
 * @property {boolean} points
 * @property {boolean} lines
 * @property {boolean} regions
 * @property {boolean} groupedViewportResults
 */

/**
 * Browser `File` objects are safe renderer inputs and must never be replaced by
 * desktop filesystem path strings merely to unify runtime signatures.
 *
 * @typedef {object} BrowserFileImportRequest
 * @property {File[]} files
 */

/**
 * @typedef {object} PickerImportRequest
 * @property {boolean} [multiple=true]
 */

/**
 * Dropped files remain renderer-safe `File` objects. A desktop preload may
 * resolve them internally, but paths must not cross back into shared UI code.
 *
 * @typedef {object} DroppedFileImportRequest
 * @property {File[]} files
 */

/**
 * @typedef {object} ExampleImportRequest
 * @property {string} name
 *   Validated relative example name, never an unrestricted URL or path.
 */

/**
 * @typedef {object} ImportBatchResult
 * @property {boolean} ok
 *   True when at least one requested file was imported successfully.
 * @property {string|null} importId
 * @property {boolean} canceled
 * @property {number} successfulCount
 * @property {number} failedCount
 * @property {ImportFileResult[]} results
 * @property {BackendFailure|null} error
 *   Batch-level failure only. Independent file failures belong in `results`.
 */

/**
 * @typedef {object} ImportFileResult
 * @property {boolean} ok
 * @property {string} fileName
 * @property {string|null} datasetId
 * @property {number} rowCount
 * @property {number} importedFeatureCount
 * @property {number} skippedRowCount
 * @property {string[]} warnings
 * @property {DetectedFields|null} detectedFields
 * @property {BackendFailure|null} error
 */

/**
 * @typedef {"queued"|"started"|"parsing"|"storing"|"completed"} ImportProgressState
 */

/**
 * @typedef {object} ImportProgress
 * @property {string} importId
 * @property {ImportProgressState} state
 * @property {string} fileName
 * @property {number} fileNumber
 * @property {number} totalFiles
 * @property {number|null} completedRows
 * @property {number|null} totalRows
 * @property {boolean|null} ok
 */

/** @typedef {(progress: ImportProgress) => void} ImportProgressListener */
/** @typedef {() => void} DataSourceUnsubscribe */

/**
 * @typedef {object} ImportCancellationResult
 * @property {boolean} ok
 * @property {string} importId
 * @property {boolean} canceled
 * @property {BackendFailure|null} error
 */

/**
 * @typedef {object} CoordinateMapping
 * @property {string|null} latField
 * @property {string|null} lonField
 */

/**
 * Coordinate and timeline fields detected for one dataset. Null means the
 * corresponding field was not detected; it does not imply a backend failure.
 *
 * @typedef {object} DetectedFields
 * @property {string|null} latField
 * @property {string|null} lonField
 * @property {string|null} yearField
 * @property {string|null} dateField
 * @property {string|null} dayOfYearField
 * @property {string|null} yearFromField
 * @property {string|null} yearToField
 * @property {string|null} dateFromField
 * @property {string|null} dateToField
 */

/**
 * Shared result for selection, visibility, and removal mutations. `changed`
 * reports whether backend state changed; a valid no-op may be successful with
 * `changed=false`.
 *
 * @typedef {object} DatasetMutationResult
 * @property {boolean} ok
 * @property {string|null} datasetId
 * @property {boolean} changed
 * @property {DatasetSummaryItem|null} dataset
 * @property {BackendFailure|null} error
 */

/**
 * @typedef {object} MappingMutationResult
 * @property {boolean} ok
 * @property {string} datasetId
 * @property {CoordinateMapping|null} mapping
 * @property {DetectedFields|null} detectedFields
 * @property {DatasetSummaryItem|null} dataset
 * @property {BackendFailure|null} error
 */

/**
 * Preview pages always use original source-row order and are independent from
 * grouped viewport rows, whose order is captured in GroupRef.
 *
 * @typedef {object} PreviewPageQuery
 * @property {string} datasetId
 * @property {number} [offset=0]
 * @property {number} [limit=30]
 */

/**
 * @typedef {object} PreviewPageResult
 * @property {string} datasetId
 * @property {Record<string, string>[]} rows
 * @property {number} offset
 * @property {number} limit
 * @property {number} totalRows
 * @property {boolean} hasMore
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
 * @property {string[]|null} [datasetIds]
 *   Explicit enabled dataset IDs when the controller supplies them. Null or
 *   omission uses the backend's current enabled-dataset state.
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
 * @property {boolean} [dayFilterEnabled]
 * @property {number|null} [startDay]
 * @property {number|null} [endDay]
 *   Day-of-year state is part of parity, but the current browser map pipeline
 *   intentionally does not apply it. Issue #103 must not expand that behavior.
 */

/**
 * @typedef {object} MapViewResult
 * @property {PointFeature[]} points
 * @property {LineFeature[]} lines
 * @property {RegionFeature[]} regions
 * @property {MapViewStats} stats
 * @property {TimelineIndex} timelineIndex
 *   Compact render results only. Complete source rows must be requested through
 *   details or paging operations and must not be embedded here.
 */

/**
 * @typedef {"exact"|"grouped"|"representative"} PointRenderType
 */

/**
 * @typedef {object} PointFeature
 * @property {string} id
 * @property {PointRenderType} [renderType]
 *   `exact` is backed by one source row. `grouped` and `representative`
 *   are compact render results and should not include full row data.
 * @property {number} lat
 * @property {number} lon
 * @property {number} [count]
 *   Number of source rows represented by this render result.
 * @property {string|null} [groupId]
 *   Stable group key for grouped or representative render results.
 * @property {GroupRef|null} [groupRef]
 *   Compact lookup context captured when a grouped render result is created.
 *   It must not contain full source rows or other detail payloads.
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
 * @typedef {'dataset-source-row'} GroupRowsSortOrder
 */

/**
 * @typedef {object} GroupGridRef
 * @property {number} cellLat
 * @property {number} cellLon
 * @property {number} cellHeight
 * @property {number} cellWidth
 */

/**
 * Immutable context needed to reproduce the rows represented by one group.
 * The originating bounds matter because edge grid cells can extend beyond the
 * viewport, while the grid dimensions depend on that viewport's render query.
 *
 * @typedef {object} GroupRef
 * @property {string} groupId
 * @property {MapBounds} bounds
 * @property {string[]} [datasetIds]
 *   Enabled dataset snapshot captured by grouped backends so later paging
 *   cannot broaden when the current UI selection or visibility changes.
 * @property {TimelineFilter|null} timeline
 * @property {GroupGridRef} grid
 * @property {GroupRowsSortOrder} sortOrder
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
 * @property {number} [totalMatchingCount]
 * @property {number} [returnedCount]
 * @property {number} [hiddenByRenderBudget]
 * @property {boolean} [overBudget]
 * @property {number} [totalMatchingLineCount]
 * @property {number} [totalMatchingRegionCount]
 * @property {number} [returnedLineCount]
 * @property {number} [returnedRegionCount]
 * @property {number} [hiddenGeometryCount]
 * @property {number|null} [geometryLimit]
 * @property {boolean} [geometryOverLimit]
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
 * @property {GroupRef|null} [groupRef]
 *   Preferred grouped-marker lookup context. It preserves the original spatial
 *   and timeline query instead of relying on the UI's current map state.
 * @property {string|null} [datasetId]
 *   Optional dataset-only lookup used by data sources without grouped markers.
 * @property {number} [offset]
 * @property {number} [limit=30]
 */

/**
 * @typedef {object} GroupRowsResult
 * @property {Record<string, string>[]} rows
 * @property {number} offset
 * @property {number} limit
 * @property {number} totalRows
 * @property {boolean} [hasMore]
 */

/**
 * @typedef {object} DatasetSummary
 * @property {DatasetSummaryItem[]} datasets
 * @property {string|null} selectedDatasetId
 *   Current session selection, or null when no dataset is selected.
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
 * @property {number|null} [sizeBytes]
 * @property {number|null} [importedFeatureCount]
 * @property {number|null} [skippedRowCount]
 * @property {string|null} [importedAt]
 * @property {string|null} latField
 * @property {string|null} lonField
 * @property {DetectedFields|null} [detectedFields]
 * @property {string[]} parseErrors
 */

/**
 * @typedef {object} TimelineSummary
 * @property {number|null} yearMin
 * @property {number|null} yearMax
 */
