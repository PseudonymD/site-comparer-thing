import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KnownAnalog, Site } from './types';
import { esc } from './format';

const MERC = 85.0511287798;

function style(): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
      dark: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community',
      },
      labels: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 13,
        attribution: 'Labels © Esri, HERE, Garmin, © OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#03050a' } },
      { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.75 } },
      { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
    ],
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
  } as StyleSpecification;
}

export interface MapApi {
  map: maplibregl.Map;
  ready: Promise<void>;
  setScoreImage(img: Uint8ClampedArray, w: number, h: number, blob: Blob | null): Promise<void>;
  setScoreVisible(visible: boolean): void;
  setOpacity(o: number): void;
  setSites(sites: Site[], label: (s: Site) => string, onClick: (s: Site, i: number) => void): void;
  setAnalogs(analogs: KnownAnalog[]): void;
  setTargetBody(body: string): void;
  highlight(lat: number, lon: number): void;
  flyTo(lat: number, lon: number, zoom?: number): void;
  setBasemap(kind: 'satellite' | 'dark'): void;
  setProjection(kind: 'globe' | 'mercator'): void;
  setPadding(p: { top: number; right: number; bottom: number; left: number }): void;
  pulseSite(i: number | null): void;
  /** Site focus: hide (or re-show) the score layer and show the imagery in full colour. */
  setFocus(on: boolean, showScore: boolean): void;
  onCellClick(cb: (lat: number, lon: number) => void): void;
}

export function createMap(container: HTMLElement): MapApi {
  const map = new maplibregl.Map({
    container,
    style: style(),
    center: [10, 20],
    zoom: 1.6,
    minZoom: 0.6,
    maxZoom: 14,
    attributionControl: { compact: true },
    renderWorldCopies: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

  // The score raster is a north-up Web-Mercator PNG covering the whole world (±85.05°), produced by
  // the worker. (A canvas source would avoid the PNG round trip, but its texture upload proved
  // unreliable on some GPUs / software renderers.)
  const COORDS: [[number, number], [number, number], [number, number], [number, number]] = [[-180, MERC], [180, MERC], [180, -MERC], [-180, -MERC]];
  const EMPTY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  let currentUrl: string | null = null;
  let opacity = 0.85;
  let siteMarkers: maplibregl.Marker[] = [];
  let analogMarkers: { m: maplibregl.Marker; a: KnownAnalog }[] = [];
  let hl: maplibregl.Marker | null = null;
  let padding = { top: 0, right: 0, bottom: 0, left: 0 };

  const ready = new Promise<void>((resolve) => {
    map.on('load', () => {
      map.addSource('score', { type: 'image', url: EMPTY, coordinates: COORDS });
      map.addLayer({ id: 'score', type: 'raster', source: 'score', paint: { 'raster-opacity': opacity, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } });
      map.addLayer({ id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.8 } });
      resolve();
    });
  });

  async function setScoreImage(img: Uint8ClampedArray, w: number, h: number, blob: Blob | null) {
    if (!blob) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.putImageData(new ImageData(img as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
      blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      if (!blob) return;
    }
    const src = map.getSource('score') as maplibregl.ImageSource | undefined;
    if (!src) return;
    const url = URL.createObjectURL(blob);
    const prev = currentUrl;
    currentUrl = url;
    src.updateImage({ url, coordinates: COORDS });
    if (prev) setTimeout(() => URL.revokeObjectURL(prev), 5000);
  }

  function setSites(sites: Site[], label: (s: Site) => string, onClick: (s: Site, i: number) => void) {
    siteMarkers.forEach((m) => m.remove());
    siteMarkers = sites.slice(0, 15).map((s, i) => {
      const el = document.createElement('div');
      el.className = 'site-marker';
      el.textContent = String(i + 1);
      el.title = label(s);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(s, i);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
    });
  }

  function setAnalogs(analogs: KnownAnalog[]) {
    analogMarkers.forEach(({ m }) => m.remove());
    analogMarkers = analogs.map((a) => {
      const el = document.createElement('div');
      el.className = 'analog-marker';
      el.title = `${a.name} (known ${a.bodies.join('/')} analog)`;
      const popup = new maplibregl.Popup({ offset: 10, closeButton: false }).setHTML(
        `<b>${esc(a.name)}</b><br><span class="popup-sub">Known ${esc(a.bodies.join(' & '))} analog · ${esc(a.country)}</span><br>${esc(a.note)}`,
      );
      const m = new maplibregl.Marker({ element: el }).setLngLat([a.lon, a.lat]).setPopup(popup).addTo(map);
      el.addEventListener('click', (e) => e.stopPropagation());
      return { m, a };
    });
  }

  function setTargetBody(body: string) {
    for (const { m, a } of analogMarkers) {
      const el = m.getElement();
      const relevant = a.bodies.includes(body);
      el.classList.toggle('dim', !relevant);
    }
  }

  function highlight(lat: number, lon: number) {
    if (!hl) {
      const el = document.createElement('div');
      el.className = 'hl-marker';
      hl = new maplibregl.Marker({ element: el });
    }
    hl.setLngLat([lon, lat]).addTo(map);
  }

  return {
    map,
    ready,
    setScoreImage,
    setScoreVisible(visible) {
      if (map.getLayer('score')) map.setLayoutProperty('score', 'visibility', visible ? 'visible' : 'none');
    },
    setOpacity(o: number) {
      opacity = o;
      if (map.getLayer('score')) map.setPaintProperty('score', 'raster-opacity', o);
    },
    setSites,
    setAnalogs,
    setTargetBody,
    highlight,
    flyTo(lat, lon, zoom = 6) {
      map.flyTo({ center: [lon, lat], zoom, padding, speed: 1.6, essential: true });
    },
    setBasemap(kind) {
      map.setLayoutProperty('satellite', 'visibility', kind === 'satellite' ? 'visible' : 'none');
      map.setLayoutProperty('dark', 'visibility', kind === 'dark' ? 'visible' : 'none');
    },
    setProjection(kind) {
      map.setProjection({ type: kind });
    },
    setPadding(p) {
      if (p.top === padding.top && p.right === padding.right && p.bottom === padding.bottom && p.left === padding.left) return;
      padding = p;
      map.easeTo({ padding: p, duration: 250 });
    },
    pulseSite(i) {
      siteMarkers.forEach((m, k) => m.getElement().classList.toggle('pulse', k === i));
    },
    setFocus(on, showScore) {
      if (map.getLayer('score')) map.setLayoutProperty('score', 'visibility', !on || showScore ? 'visible' : 'none');
      map.setPaintProperty('satellite', 'raster-saturation', on ? 0 : -0.35);
      map.setPaintProperty('satellite', 'raster-brightness-max', on ? 1 : 0.75);
    },
    onCellClick(cb) {
      map.on('click', (e) => cb(e.lngLat.lat, ((e.lngLat.lng + 540) % 360) - 180));
    },
  };
}
