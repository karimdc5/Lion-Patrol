import { describe, it, expect } from 'vitest';
import { gpsLine, gpsStatusFor } from '../../src/lib/geo';

// Trailside (real account): 100 Example St, Federal Way, 150 m geofence.
const site = { lat: 47.32, lng: -122.31, geofence_m: 150, address: '100 Example St', city: 'Federal Way' };

describe('pass 9 A1: GPS status + honest location lines', () => {
  it('classifies inside / outside / unavailable / no pin', () => {
    expect(gpsStatusFor(site, { lat: 47.3201, lng: -122.3101, accuracy: 10 }).status).toBe('ok');
    const far = gpsStatusFor(site, { lat: 47.6062, lng: -122.3321, accuracy: 10 });
    expect(far.status).toBe('outside');
    expect(far.distance).toBeGreaterThan(5000);
    expect(gpsStatusFor(site, null)).toEqual({ status: 'unavailable', distance: null });
    expect(gpsStatusFor({ lat: null, lng: null, geofence_m: 150 }, null).status).toBe('unavailable');
  });
  it('never claims a GPS fix that does not exist: falls back to the labeled site address', () => {
    expect(gpsLine({ lat: null, lng: null }, site)).toBe('Site address (GPS unavailable): 100 Example St, Federal Way');
    expect(gpsLine({ lat: null, lng: null })).toBe('GPS unavailable');
    expect(gpsLine({ lat: 47.3201, lng: -122.3101, accuracy: 9.6 }, site)).toMatch(/^GPS 47\.32010, -122\.31010 ±10 m · at site/);
    expect(gpsLine({ lat: 47.6062, lng: -122.3321, accuracy: 10 }, site)).toContain('OUTSIDE geofence');
  });
});
