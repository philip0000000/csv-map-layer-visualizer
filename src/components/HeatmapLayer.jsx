import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { getHeatOptions, toHeatContributions } from './heatmap';

const HEAT_PANE = 'pointHeatmap';

// Version 0.2.0 always attaches to overlayPane. Keep the adaptation here rather
// than patching the dependency, so CSV geometry retains its existing panes.
const AppHeatLayer = L.HeatLayer.extend({
  /** Move the initialized canvas below vectors while retaining plugin map events. */
  onAdd(map) {
    L.HeatLayer.prototype.onAdd.call(this, map);
    map.getPane(HEAT_PANE).appendChild(this._canvas);
    this._canvas.style.pointerEvents = 'none';
  },
  /** Cancel queued draws and detach events when toggled off or StrictMode remounts. */
  onRemove(map) {
    L.Util.cancelAnimFrame(this._frame);
    this._frame = null;
    this._canvas.remove();
    map.off('moveend', this._reset, this);
    map.off('zoomanim', this._animateZoom, this);
    this._map = null;
  },
});

/** Own one non-interactive heat canvas and legend for the filtered point results. */
export default function HeatmapLayer({ points, radius }) {
  const map = useMap();
  const layerRef = useRef(null);
  const contributions = useMemo(() => toHeatContributions(points), [points]);

  useEffect(() => {
    const pane = map.getPane(HEAT_PANE) ?? map.createPane(HEAT_PANE);
    pane.style.zIndex = '350';
    pane.style.pointerEvents = 'none';
    const layer = new AppHeatLayer([], getHeatOptions());
    layerRef.current = layer;
    layer.addTo(map);

    // The CSV sidebar covers the left map edge; share the zoom-control corner.
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const element = L.DomUtil.create('div', 'heatmapLegend');
      element.innerHTML = '<div>Recorded point concentration</div>'
        + '<div class="heatmapLegendScale"><span>Low</span>'
        + '<span class="heatmapLegendGradient" aria-hidden="true"></span><span>High</span></div>'
        + '<div class="heatmapLegendNote">Approximate overview</div>';
      element.style.pointerEvents = 'none';
      return element;
    };
    legend.addTo(map);

    return () => {
      legend.remove();
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setOptions(getHeatOptions(radius));
    layer.setLatLngs(contributions);
    if (contributions.length === 0) {
      // setLatLngs schedules a frame; erase old heat immediately for empty filters.
      const canvas = layer._canvas;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [contributions, radius]);

  return null;
}
