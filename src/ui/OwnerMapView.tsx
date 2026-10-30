import { useEffect, useRef } from 'preact/hooks';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

export interface SitePin { id: string; lat: number; lng: number; name: string; address: string; onDuty: number; photo?: () => Promise<string | null> }
export interface GuardPin { id: string; lat: number; lng: number; name: string; site: string; seen: string }

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Lazy chunk: owner map on OpenStreetMap tiles (free, no key), darkened with CSS to fit the app. */
export default function OwnerMapView({ sites, guards, height = 520 }: { sites: SitePin[]; guards: GuardPin[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([47.38, -122.23], 11);
    L.tileLayer(OSM, { maxZoom: 19, className: 'osm-dark', attribution: '© OpenStreetMap contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const g = layer.current, m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const s of sites) {
      const icon = L.divIcon({ className: 'map-site-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -20] });
      const mk = L.marker([s.lat, s.lng], { icon, title: s.name, alt: s.name }).addTo(g);
      mk.bindPopup(() => sitePopup(s), { minWidth: 220, maxWidth: 260, className: 'map-popup' });
      pts.push([s.lat, s.lng]);
    }
    for (const gd of guards) {
      L.circleMarker([gd.lat, gd.lng], { radius: 9, color: '#0A0F1C', weight: 3, fillColor: '#22C55E', fillOpacity: 1 })
        .bindTooltip(`${esc(gd.name)} · ${esc(gd.seen)}`, { direction: 'top', offset: [0, -8] })
        .bindPopup(() => guardPopup(gd), { className: 'map-popup' })
        .addTo(g);
      pts.push([gd.lat, gd.lng]);
    }
    if (pts.length && !fitted.current) { m.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 }); fitted.current = true; }
  }, [JSON.stringify(sites.map((s) => [s.id, s.lat, s.lng, s.onDuty])), JSON.stringify(guards)]);
  return <div ref={el} class="map-box owner-map" style={{ height }} data-testid="owner-map" />;
}

function esc(t: string) { return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

/** Popup DOM (no HTML strings from user data). The photo loads lazily via a signed URL. */
function sitePopup(s: SitePin): HTMLElement {
  const root = document.createElement('div');
  root.className = 'map-pop';
  root.dataset.testid = 'map-site-popup';
  const img = document.createElement('div');
  img.className = 'map-pop-img';
  root.appendChild(img);
  const b = document.createElement('b'); b.textContent = s.name; root.appendChild(b);
  const a = document.createElement('div'); a.className = 'map-pop-sub'; a.textContent = s.address; root.appendChild(a);
  const d = document.createElement('div'); d.className = 'map-pop-sub'; d.textContent = s.onDuty ? `${s.onDuty} on duty now` : 'No one on duty'; root.appendChild(d);
  if (s.photo) void s.photo().then((u) => { if (u) { const i = document.createElement('img'); i.src = u; i.alt = `${s.name} photo`; img.appendChild(i); } else img.remove(); });
  else img.remove();
  return root;
}
function guardPopup(g: GuardPin): HTMLElement {
  const root = document.createElement('div');
  root.className = 'map-pop';
  const b = document.createElement('b'); b.textContent = g.name; root.appendChild(b);
  const a = document.createElement('div'); a.className = 'map-pop-sub'; a.textContent = `On duty · ${g.site}`; root.appendChild(a);
  const d = document.createElement('div'); d.className = 'map-pop-sub'; d.textContent = g.seen; root.appendChild(d);
  return root;
}
