import { useEffect, useRef } from 'preact/hooks';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

export interface Marker { lat: number; lng: number; label: string; color?: string }

/** Lazy chunk: Leaflet with Carto dark tiles (free, no key). Tap to place when `onPick` is set. */
export default function MapView({ center, markers = [], onPick, zoom = 16, height = 260 }: { center: { lat: number; lng: number }; markers?: Marker[]; onPick?: (p: { lat: number; lng: number }) => void; zoom?: number; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    if (onPick) m.on('click', (e: L.LeafletMouseEvent) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const mk of markers) {
      L.circleMarker([mk.lat, mk.lng], { radius: 9, color: '#0A0F1C', weight: 3, fillColor: mk.color ?? '#D4A537', fillOpacity: 1 }).bindTooltip(mk.label, { direction: 'top', offset: [0, -8] }).addTo(g);
    }
  }, [JSON.stringify(markers)]);
  useEffect(() => { map.current?.setView([center.lat, center.lng]); }, [center.lat, center.lng]);
  return <div ref={el} class="map-box" style={{ height }} data-testid="map" />;
}
