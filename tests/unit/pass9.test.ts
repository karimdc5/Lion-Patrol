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

import { toPacificInput, fromPacificInput } from '../../src/lib/format';
import { longFlag, weekByMember, weekStart } from '../../src/domain/timesheet';
import { buildInvoiceLines, missingBillingField, invoiceState } from '../../src/domain/invoice';

describe('pass 9 A2/A3: timesheets + invoices', () => {
  it('Pacific datetime inputs round-trip across DST', () => {
    expect(toPacificInput('2026-10-25T08:04:00Z')).toBe('2026-10-25T01:04');          // PDT
    expect(fromPacificInput('2026-10-29T22:12')).toBe('2026-10-30T05:12:00.000Z');   // PDT
    expect(fromPacificInput('2026-11-07T23:38')).toBe('2026-11-08T07:38:00.000Z');   // PST
  });
  it('flags the 117 h forgotten clock-out and never counts voided shifts', () => {
    const big = { id: 'a', member_id: 'k', site_id: 'TS', clock_in_at: '2026-10-25T08:04:00Z', clock_out_at: '2026-10-30T05:12:00Z' };
    expect(longFlag(big)).toBe('over24');
    expect(longFlag({ ...big, clock_out_at: '2026-10-25T21:00:00Z' })).toBe('over12');
    expect(longFlag({ ...big, voided_at: '2026-11-08T00:00:00Z' })).toBeNull();
    const w = weekByMember([big, { ...big, id: 'b', voided_at: 'x' }], weekStart(new Date(2026, 9, 21)))[0]!;
    expect(w.long).toBe(1); expect(w.voided).toBe(1);
    expect(w.total).toBeCloseTo(117.13, 1);
  });
  it('lists unconfirmed/open shifts instead of a silent $0, skips voided, names the missing billing field', () => {
    const rows = [
      { id: '1', member_id: 'k', site_id: 'TS', clock_in_at: '2026-10-25T07:23:00Z', clock_out_at: '2026-10-25T07:27:00Z' },
      { id: '2', member_id: 'k', site_id: 'TS', clock_in_at: '2026-10-25T08:04:00Z', clock_out_at: '2026-10-30T05:12:00Z', voided_at: 'x' },
      { id: '3', member_id: 'k', site_id: 'TS', clock_in_at: '2026-10-26T08:00:00Z', clock_out_at: null },
    ];
    const r = buildInvoiceLines(rows, { siteId: 'TS', month: '2026-10-01', rate: 50, names: { k: 'Karim' }, onlyConfirmed: true }, Date.parse('2026-10-26T10:00:00Z'));
    expect(r.lines).toEqual([]);
    expect(r.leftOut.map((l) => [l.id, l.reason])).toEqual([['1', 'unconfirmed'], ['3', 'open']]);
    expect(missingBillingField(null)).toBe('Rate per guard hour ($)');
    expect(missingBillingField({ hourly_rate: 50 })).toBeNull();
    expect(invoiceState({ status: 'sent', due_date: '2026-11-01' }, '2026-11-10')).toBe('overdue');
    expect(invoiceState({ status: 'sent', due_date: '2026-11-30' }, '2026-11-10')).toBe('unpaid');
  });
});
