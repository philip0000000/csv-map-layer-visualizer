import { useEffect, useRef } from "react";
import { useCallback, useState } from 'react';
// Import core components from react-leaflet.
// MapContainer is the main map wrapper.
// TileLayer is used to load map tiles (images).
// Marker and Popup are used to show points on the map.
// LayersControl provides Leaflet's built-in "layers" button (base maps + overlays).
import {
  MapContainer,
  LayersControl,
  TileLayer,
  LayerGroup,
  Marker,
  ImageOverlay,
  Polygon,
  Polyline,
  Popup,
  ZoomControl,
  useMap,
} from "react-leaflet";

// MarkerClusterGroup is a React wrapper around Leaflet's marker clustering plugin.
// It groups nearby markers into clusters for readability and performance.
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet-polylinedecorator";

import { getClusterMarkerIcon, getMarkerIcon } from "./markerIcons";

import { DEFAULT_GROUP_ROWS_LIMIT } from '../data/dataSource';

/**
 * Build a list of fields to show in the popup.
 *
 * - row: one CSV row (object with key/value pairs)
 * - latField / lonField: column names used for coordinates
 * - limit: max number of fields to show
 *
 * Latitude and longitude fields are skipped,
 * because they are already shown at the top.
 */
function buildPopupFields(row, latField, lonField, limit = 30) {
  if (!row || typeof row !== "object") return [];

  // Get all column names except lat/lon
  const keys = Object.keys(row).filter((k) => k !== latField && k !== lonField);

  // Keep only the first few fields to keep popup readable
  return keys.slice(0, limit).map(
    (k) => [k, row[k]]
  );
}

/**
 * Build the popup content for one point.
 * Kept in a helper so the Marker and Clustered Marker render paths stay identical.
 */
function getFeaturePopupRow(feature, getSourceRow) {
  return feature?.row ?? getSourceRow?.(feature?.sourceFileId, feature?.sourceRowIndex) ?? null;
}

function PointPopup({
  point: p,
  latField,
  lonField,
  getSourceRow,
  getFeatureDetails,
}) {
  const requestVersionRef = useRef(0);
  const [detailState, setDetailState] = useState({
    status: 'idle',
    details: null,
  });
  const shouldLoadDetails =
    typeof getFeatureDetails === 'function' && !!p?.sourceRef;
  const synchronousRow = getFeaturePopupRow(p, getSourceRow);
  const row = shouldLoadDetails
    ? detailState.details?.row ?? null
    : synchronousRow;
  const resolvedLatField = detailState.details?.latField ?? latField;
  const resolvedLonField = detailState.details?.lonField ?? lonField;

  const handlePopupOpen = useCallback(() => {
    if (!shouldLoadDetails) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setDetailState({ status: 'loading', details: null });

    Promise.resolve(getFeatureDetails({
      featureId: p.id,
      sourceRef: p.sourceRef,
    })).then((details) => {
      if (requestVersionRef.current !== requestVersion) return;

      setDetailState({
        status: details?.row ? 'loaded' : 'empty',
        details: details?.row ? details : null,
      });
    }).catch(() => {
      if (requestVersionRef.current !== requestVersion) return;
      setDetailState({ status: 'error', details: null });
    });
  }, [getFeatureDetails, p.id, p.sourceRef, shouldLoadDetails]);

  const handlePopupClose = useCallback(() => {
    // Ignore a late reply if this popup closes before its request finishes.
    requestVersionRef.current += 1;
  }, []);

  useEffect(() => () => {
    requestVersionRef.current += 1;
  }, []);

  return (
    <Popup
      eventHandlers={{
        add: handlePopupOpen,
        remove: handlePopupClose,
      }}
    >
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Point</div>

        {/* Always show coordinates */}
        <div>
          <b>lat:</b> {p.lat}
        </div>
        <div>
          <b>lon:</b> {p.lon}
        </div>

        <hr style={{ opacity: 0.25 }} />

        {shouldLoadDetails && (
          detailState.status === 'idle' || detailState.status === 'loading'
        ) && (
          <div>Loading details...</div>
        )}
        {shouldLoadDetails && detailState.status === 'empty' && (
          <div>No details found.</div>
        )}
        {shouldLoadDetails && detailState.status === 'error' && (
          <div>Could not load details.</div>
        )}

        {(!shouldLoadDetails || detailState.status === 'loaded') &&
        buildPopupFields(row, resolvedLatField, resolvedLonField).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <b>{k}:</b> {String(v ?? "")}
          </div>
        ))}
      </div>
    </Popup>
  );
}

/**
 * Load backing SQLite rows only after a grouped marker popup opens.
 */
function GroupedPointPopup({ point: p, getGroupRows }) {
  const requestVersionRef = useRef(0);
  const [pagingState, setPagingState] = useState({
    status: 'idle',
    rows: [],
    totalRows: null,
    error: null,
  });
  const canLoadGroupRows =
    typeof getGroupRows === 'function' && !!p?.groupRef;

  const loadPage = useCallback((offset, replaceRows) => {
    if (!canLoadGroupRows) return;

    // groupRef keeps every page tied to the group created by the original query.
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setPagingState((previous) => ({
      ...previous,
      status: offset === 0 ? 'loading' : 'loading-more',
      rows: replaceRows ? [] : previous.rows,
      totalRows: replaceRows ? null : previous.totalRows,
      error: null,
    }));

    Promise.resolve(getGroupRows({
      groupRef: p.groupRef,
      offset,
      limit: DEFAULT_GROUP_ROWS_LIMIT,
    })).then((result) => {
      if (requestVersionRef.current !== requestVersion) return;

      const pageRows = Array.isArray(result?.rows) ? result.rows : [];
      setPagingState((previous) => {
        // Opening starts a fresh list; "Show more" appends the next stable page.
        const rows = replaceRows
          ? pageRows
          : [...previous.rows, ...pageRows];

        return {
          status: 'loaded',
          rows,
          totalRows: result?.totalRows ?? rows.length,
          error: null,
        };
      });
    }).catch(() => {
      if (requestVersionRef.current !== requestVersion) return;

      setPagingState((previous) => ({
        ...previous,
        status: previous.rows.length > 0 ? 'loaded' : 'error',
        error: 'Could not load group rows.',
      }));
    });
  }, [canLoadGroupRows, getGroupRows, p.groupRef]);

  const handlePopupOpen = useCallback(() => {
    loadPage(0, true);
  }, [loadPage]);

  const handlePopupClose = useCallback(() => {
    requestVersionRef.current += 1;
  }, []);

  const handleShowMore = useCallback((event) => {
    event.stopPropagation();
    loadPage(pagingState.rows.length, false);
  }, [loadPage, pagingState.rows.length]);

  useEffect(() => () => {
    requestVersionRef.current += 1;
  }, []);

  const canShowMore =
    canLoadGroupRows &&
    pagingState.totalRows != null &&
    pagingState.rows.length < pagingState.totalRows;
  const title = p.renderType === "representative"
    ? "Representative marker"
    : "Grouped markers";

  return (
    <Popup
      maxWidth={460}
      eventHandlers={{
        add: handlePopupOpen,
        remove: handlePopupClose,
      }}
    >
      <div style={{ minWidth: 280, maxWidth: 420 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
        <div>
          <b>count:</b> {p.count ?? 1}
        </div>
        <div>
          <b>lat:</b> {p.lat}
        </div>
        <div>
          <b>lon:</b> {p.lon}
        </div>

        {canLoadGroupRows && (
          <div
            style={{
              borderTop: '1px solid rgba(0, 0, 0, 0.15)',
              marginTop: 8,
              paddingTop: 8,
            }}
          >
            {(pagingState.status === 'idle' ||
              pagingState.status === 'loading') && (
              <div>Loading rows...</div>
            )}
            {pagingState.status === 'error' && (
              <div>{pagingState.error}</div>
            )}
            {pagingState.status === 'loaded' &&
              pagingState.rows.length === 0 && (
                <div>No represented rows found.</div>
              )}
            {pagingState.rows.length > 0 && (
              <>
                <div style={{ marginBottom: 6 }}>
                  Loaded {pagingState.rows.length} of{' '}
                  {pagingState.totalRows ?? pagingState.rows.length} rows
                </div>
                <div
                  style={{
                    maxHeight: 260,
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {pagingState.rows.map((row, index) => (
                    <details
                      key={[p.id, index].join(':')}
                      style={{ marginBottom: 6 }}
                    >
                      <summary>Row {index + 1}</summary>
                      <div style={{ padding: '4px 0 2px 10px' }}>
                        {buildPopupFields(row, null, null).map(([key, value]) => (
                          <div key={key} style={{ marginBottom: 3 }}>
                            <b>{key}:</b> {String(value ?? '')}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </>
            )}
            {pagingState.rows.length > 0 && pagingState.error && (
              <div style={{ marginTop: 6 }}>{pagingState.error}</div>
            )}
            {canShowMore && (
              <button
                type='button'
                onClick={handleShowMore}
                disabled={pagingState.status === 'loading-more'}
                style={{ marginTop: 8 }}
              >
                {pagingState.status === 'loading-more'
                  ? 'Loading...'
                  : 'Show 30 more'}
              </button>
            )}
          </div>
        )}
      </div>
    </Popup>
  );
}

function isGroupedPointFeature(point) {
  return point?.renderType === "grouped" || point?.renderType === "representative";
}

/**
 * Attach the CSV marker value to the Leaflet marker instance.
 * MarkerClusterGroup only sees Leaflet markers, so the cluster icon code reads this later.
 */
function setCsvMarkerValue(marker, markerValue) {
  if (marker) {
    marker.options.csvMarkerValue = markerValue;
  }
}

/**
 * Build a custom cluster icon from the first marker in the cluster.
 * This preserves the first row marker style and adds the cluster count badge.
 */
function createMarkerClusterIcon(cluster) {
  const childMarkers = typeof cluster?.getAllChildMarkers === "function"
    ? cluster.getAllChildMarkers()
    : [];
  const firstMarkerValue = childMarkers[0]?.options?.csvMarkerValue;
  const count = typeof cluster?.getChildCount === "function"
    ? cluster.getChildCount()
    : childMarkers.length;

  return getClusterMarkerIcon(firstMarkerValue, count);
}

/**
 * Hide the original cluster icon while spiderfied markers are spread out.
 * The spread markers remain visible; the center marker would just add visual noise.
 */
function setClusterIconVisibility(cluster, isVisible) {
  const iconElement =
    typeof cluster?.getElement === "function"
      ? cluster.getElement()
      : cluster?._icon;

  if (iconElement) {
    iconElement.style.visibility = isVisible ? "" : "hidden";
  }
}

function renderRegionPopup(region, latField, lonField, getSourceRow) {
  const row = getFeaturePopupRow(region, getSourceRow);
  // Prefer a human-readable name from the CSV row, fall back to featureId, then a generic label
  const title = String(row?.name ?? region?.featureId ?? "Region");

  return (
    <Popup>
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>

        {buildPopupFields(row, latField, lonField).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <b>{k}:</b> {String(v ?? "")}
          </div>
        ))}
      </div>
    </Popup>
  );
}


function renderLinePopup(line, latField, lonField, getSourceRow) {
  const row = getFeaturePopupRow(line, getSourceRow);
  const title = String(row?.name ?? line?.featureId ?? "Line");

  return (
    <Popup>
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>

        {buildPopupFields(row, latField, lonField).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <b>{k}:</b> {String(v ?? "")}
          </div>
        ))}
      </div>
    </Popup>
  );
}

function LineArrowDecorator({ line }) {
  const map = useMap();

  useEffect(() => {
    const mode = String(line?.arrow ?? "none").toLowerCase();
    if (mode === "none") return undefined;

    const coords = Array.isArray(line?.coordinates) ? line.coordinates : [];
    if (coords.length < 2) return undefined;

    if (typeof L.polylineDecorator !== "function" || !L.Symbol?.arrowHead) {
      return undefined;
    }

    const color = line?.style?.color ?? "#3388ff";
    const weight = Number.isFinite(line?.style?.weight) ? line.style.weight : 3;
    const pixelSize = Math.max(
      6,
      Math.min(18, Math.round(weight * 2 * 1.4))
    );
    const patterns = [];

    if (mode === "start" || mode === "both") {
      patterns.push({
        offset: "0%",
        repeat: 0,
        symbol: L.Symbol.arrowHead({
          pixelSize,
          polygon: true,
          pathOptions: {
            color,
            weight: 1,
            fillOpacity: 1,
            fillColor: color,
          },
        }),
      });
    }

    if (mode === "end" || mode === "both") {
      patterns.push({
        offset: "100%",
        repeat: 0,
        symbol: L.Symbol.arrowHead({
          pixelSize,
          polygon: true,
          pathOptions: {
            color,
            weight: 1,
            fillOpacity: 1,
            fillColor: color,
          },
        }),
      });
    }

    if (patterns.length === 0) return undefined;

    const decorator = L.polylineDecorator(coords, { patterns });
    decorator.addTo(map);

    return () => {
      map.removeLayer(decorator);
    };
  }, [
    map,
    line?.arrow,
    line?.coordinates,
    line?.style?.color,
    line?.style?.weight,
  ]);

  return null;
}
function ViewportChangeReporter({ onViewportChange }) {
  const map = useMap();

  useEffect(() => {
    if (typeof onViewportChange !== "function") return undefined;

    const reportViewport = () => {
      const bounds = map.getBounds();

      onViewportChange({
        bounds: {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
        zoom: map.getZoom(),
      });
    };

    reportViewport();

    map.on("moveend zoomend", reportViewport);

    return () => {
      map.off("moveend zoomend", reportViewport);
    };
  }, [map, onViewportChange]);

  return null;
}
/**
 * Map tile providers.
 * We expose:
 * - Base layers (radio buttons): only one can be active at a time.
 * - Overlays (checkboxes): can be layered on top of any base layer.
 *
 * Notes:
 * - OSM is your current default.
 * - Esri World Imagery is a common "no key" satellite option.
 * - The "Labels + boundaries" overlay provides country borders + city/place names.
 */
const TILESETS = {
  osm: {
    name: "Normal (OSM)",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },

  satellite: {
    name: "Satellite (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 20,
  },

  labelsBoundaries: {
    name: "Labels + boundaries",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 20,
  },
};

const BLANK_BASE_LAYER_NAME = "Blank background";

export default function GeoMap({
  points = [],
  regions = [],
  lines = [],

  // When true, nearby markers are grouped into clusters (visual-only feature).
  // When false, markers are rendered normally (current behavior).
  getSourceRow,
  getFeatureDetails,
  getGroupRows,
  clusterMarkersEnabled = false,
  clusterRadius = 80,   // default strength
  onViewportChange,
}) {
  const { BaseLayer, Overlay } = LayersControl;
  const markerClusterGroupRef = useRef(null);
  const markerPoints = points.filter((p) => !p.image);
  // Data-source groups are already summarized, so keep them out of client clustering.
  const exactMarkerPoints = markerPoints.filter((p) => !isGroupedPointFeature(p));
  const groupedMarkerPoints = markerPoints.filter(isGroupedPointFeature);
  const imagePoints = points.filter((p) => !!p.image);

  // Hide the original cluster icon while MarkerClusterGroup spiderfies exact-overlap markers.
  useEffect(() => {
    const group = markerClusterGroupRef.current;
    if (!group) return undefined;

    const handleSpiderfied = (event) => {
      setClusterIconVisibility(event?.cluster, false);
    };

    const handleUnspiderfied = (event) => {
      setClusterIconVisibility(event?.cluster, true);
    };

    group.on("spiderfied", handleSpiderfied);
    group.on("unspiderfied", handleUnspiderfied);

    return () => {
      group.off("spiderfied", handleSpiderfied);
      group.off("unspiderfied", handleUnspiderfied);
    };
  }, [clusterMarkersEnabled, clusterRadius]);

  return (
    // MapContainer must have a fixed height and width.
    // If not, the map will not render correctly.
    <MapContainer
      // Initial center of the map.
      // This is Stockholm (latitude, longitude).
      center={[59.3293, 18.0686]}

      // Initial zoom level.
      // Lower value = more zoomed out.
      zoom={5}
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: "#ffffff",
      }}
      zoomControl={false}
    >
      <ViewportChangeReporter onViewportChange={onViewportChange} />

      {/* Zoom controls moved away from the CSV overlay */}
      <ZoomControl position="bottomright" />

      {/*
        Leaflet built-in "layers" control:
        - Base layers (radio buttons) for Blank, Normal, or Satellite.
        - Overlay (checkbox) for labels/boundaries on top of either base layer.
      */}
      <LayersControl position="topright" collapsed={true}>
        {/* Base layer: blank white canvas with no tiles */}
        <BaseLayer name={BLANK_BASE_LAYER_NAME}>
          <LayerGroup />
        </BaseLayer>

        {/* Base layer: Normal map (default checked) */}
        <BaseLayer checked name={TILESETS.osm.name}>
          <TileLayer
            // Required attribution for OpenStreetMap data.
            attribution={TILESETS.osm.attribution}
            // Standard OpenStreetMap tile server URL.
            url={TILESETS.osm.url}
            maxZoom={TILESETS.osm.maxZoom}
          />
        </BaseLayer>

        {/* Base layer: Satellite imagery */}
        <BaseLayer name={TILESETS.satellite.name}>
          <TileLayer
            attribution={TILESETS.satellite.attribution}
            url={TILESETS.satellite.url}
            maxZoom={TILESETS.satellite.maxZoom}
          />
        </BaseLayer>

        {/* Overlay: country borders + city/place labels (works nicely on satellite) */}
        <Overlay name={TILESETS.labelsBoundaries.name} checked={false}>
          <TileLayer
            attribution={TILESETS.labelsBoundaries.attribution}
            url={TILESETS.labelsBoundaries.url}
            maxZoom={TILESETS.labelsBoundaries.maxZoom}
            // Keep overlay crisp and readable.
            // If you ever want it softer, drop opacity to ~0.85.
            opacity={1}
          />
        </Overlay>
      </LayersControl>

      {/*
        Render markers for each point derived from enabled CSV files.

        Optional marker clustering.
        - When clustering is enabled, markers are grouped into clusters (Leaflet.markercluster behavior).
        - Clicking a cluster zooms in and reveals the markers inside.
        - When disabled, markers are shown normally (current behavior).
      */}
      {clusterMarkersEnabled ? (
        <MarkerClusterGroup
          ref={markerClusterGroupRef}
          // Force a re-init when clustering settings change.
          // Leaflet.markercluster does not always apply maxClusterRadius updates dynamically.
          key={`cluster:${clusterMarkersEnabled ? 1 : 0}:${clusterRadius}`}
          // chunkedLoading improves responsiveness when there are many markers.
          // It progressively adds markers to the map instead of blocking the UI.
          chunkedLoading
          iconCreateFunction={createMarkerClusterIcon}
          maxClusterRadius={clusterRadius}
        >
          {exactMarkerPoints.map((p) => {
            const icon = getMarkerIcon(p.marker);

            return (
              <Marker
                key={p.id}
                ref={(marker) => setCsvMarkerValue(marker, p.marker)}
                position={[p.lat, p.lon]}
                {...(icon ? { icon } : {})}
              >
                <PointPopup
                  point={p}
                  latField={p.latField}
                  lonField={p.lonField}
                  getSourceRow={getSourceRow}
                  getFeatureDetails={getFeatureDetails}
                />
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      ) : (
        exactMarkerPoints.map((p) => {
          const icon = getMarkerIcon(p.marker);

          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lon]}
              {...(icon ? { icon } : {})}
            >
              <PointPopup
                point={p}
                latField={p.latField}
                lonField={p.lonField}
                getSourceRow={getSourceRow}
                getFeatureDetails={getFeatureDetails}
              />
            </Marker>
          );
        })
      )}

      {/* Render grouped SQLite summaries as count markers, separate from exact marker clustering. */}
      {groupedMarkerPoints.map((p) => {
        const icon = getClusterMarkerIcon(p.marker, p.count);

        return (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            {...(icon ? { icon } : {})}
          >
            <GroupedPointPopup point={p} getGroupRows={getGroupRows} />
          </Marker>
        );
      })}

      {imagePoints.map((p) => (
        <ImageOverlay
          key={`image:${p.id}`}
          url={p.image}
          bounds={buildPointImageBounds(p)}
          interactive
        >
          <PointPopup
            point={p}
            latField={p.latField}
            lonField={p.lonField}
            getSourceRow={getSourceRow}
            getFeatureDetails={getFeatureDetails}
          />
        </ImageOverlay>
      ))}

      {regions.map((region) => (
        <Polygon
          key={region.id}
          positions={region.coordinates}
          pathOptions={region.style}
        >
          {renderRegionPopup(region, region.latField, region.lonField, getSourceRow)}
        </Polygon>
      ))}

      {lines.map((line) => (
        <LayerGroup key={line.id}>
          <Polyline positions={line.coordinates} pathOptions={line.style}>
            {renderLinePopup(line, line.latField, line.lonField, getSourceRow)}
          </Polyline>
          <LineArrowDecorator line={line} />
        </LayerGroup>
      ))}
    </MapContainer>
  );
}

function buildPointImageBounds(point) {
  // Build bounds from point and size.
  const latMeters = 111320;
  const lonMeters = 111320 * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.000001);

  const halfWidthDegrees = (point.imageWidthMeters / 2) / lonMeters;
  const heightDegrees = point.imageHeightMeters / latMeters;

  const south = point.lat;
  const north = point.lat + heightDegrees;
  const west = point.lon - halfWidthDegrees;
  const east = point.lon + halfWidthDegrees;

  return [
    [south, west],
    [north, east],
  ];
}
