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
