export interface Fix { lat: number; lng: number; accuracy: number; at: number }

let last: Fix | null = null;
export function lastFix() { return last; }

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** One-shot position. Never rejects: resolves null on denial/timeout (falls back to a recent fix). */
export function getFix(timeoutMs = 8000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(last);
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(last && Date.now() - last.at < 5 * 60e3 ? last : null); } }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { if (done) return; done = true; clearTimeout(t); last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }; resolve(last); },
      () => { if (done) return; done = true; clearTimeout(t); resolve(last && Date.now() - last.at < 5 * 60e3 ? last : null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}

let watchId: number | null = null;
/** Foreground-only watch. iOS suspends home-screen apps in the background, so pings pause then. */
export function startWatch(onFix: (f: Fix) => void) {
  stopWatch();
  if (!('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    (p) => { last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }; onFix(last); },
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
  );
}
export function stopWatch() {
  if (watchId != null && 'geolocation' in navigator) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
export function isWatching() { return watchId != null; }

/** Item 18 geofence: inside when within the site radius plus the fix accuracy (capped at 100 m). Sites without a pin always pass. */
export function geofenceCheck(site: { lat: number | null; lng: number | null; geofence_m: number }, fix: { lat: number; lng: number; accuracy: number } | null): { ok: boolean; distance: number | null } {
  if (site.lat == null || site.lng == null) return { ok: true, distance: null };
  if (!fix) return { ok: false, distance: null };
  const d = distanceM(fix, { lat: site.lat, lng: site.lng });
  return { ok: d <= site.geofence_m + Math.min(fix.accuracy || 0, 100), distance: d };
}

/** Pass 9 A1: how a clock-in/out location was recorded (stored on the time entry). */
export type GpsStatus = 'ok' | 'outside' | 'unavailable' | 'no_site_pin';
export function gpsStatusFor(site: { lat: number | null; lng: number | null; geofence_m: number }, fix: { lat: number; lng: number; accuracy: number } | null): { status: GpsStatus; distance: number | null } {
  if (site.lat == null || site.lng == null) return { status: fix ? 'ok' : 'unavailable', distance: null };
  const g = geofenceCheck(site, fix);
  if (!fix) return { status: 'unavailable', distance: null };
  return { status: g.ok ? 'ok' : 'outside', distance: g.distance == null ? null : Math.round(g.distance) };
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1609).toFixed(1)} mi`);

/**
 * Honest one-line location for Live / Activity / Timesheets / PDFs. Never implies a GPS fix that
 * doesn't exist: without coordinates it says so and falls back to the site address, labeled.
 */
export function gpsLine(p: { lat?: unknown; lng?: unknown; accuracy?: unknown }, site?: { lat: number | null; lng: number | null; geofence_m?: number; address?: string | null; city?: string | null } | null): string {
  const lat = p.lat == null ? null : Number(p.lat), lng = p.lng == null ? null : Number(p.lng);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    const addr = site ? [site.address, site.city].filter(Boolean).join(', ') : '';
    return addr ? `Site address (GPS unavailable): ${addr}` : 'GPS unavailable';
  }
  const acc = p.accuracy == null ? '' : ` ±${Math.round(Number(p.accuracy))} m`;
  let where = '';
  if (site && site.lat != null && site.lng != null) {
    const d = distanceM({ lat, lng }, { lat: site.lat, lng: site.lng });
    where = d <= (site.geofence_m ?? 150) + Math.min(Number(p.accuracy ?? 0) || 0, 100) ? ` · at site (${fmtDistance(d)} from pin)` : ` · ${fmtDistance(d)} from site — OUTSIDE geofence`;
  }
  return `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}${acc}${where}`;
}
