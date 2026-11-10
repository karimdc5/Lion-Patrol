import { describe, it, expect } from 'vitest';
import { siteProof, clientProofRpcs } from '../../src/data/backend/memoryClient';

// Pass 9 chunk 2 (A7/C1): the memory/demo mirror of patrol_site_proof.
const ORG = 'org-1';
const SITE = 'site-1';
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
function state(extra: Record<string, any[]> = {}) {
  return {
    tables: {
      patrol_sites: [{ id: SITE, org_id: ORG, name: 'Trailside', tour_interval_min: 60 }],
      patrol_org_settings: [{ id: ORG, org_id: ORG, tour_interval_min: 60 }],
      patrol_members: [{ id: 'm-guard', org_id: ORG, display_name: 'Secret Guardname', role: 'guard' }],
      ...extra,
    } as Record<string, any[]>,
  };
}
const ctx = { memberIds: [], clientSites: [SITE], staffOrgs: [], adminOrgs: [], members: [], memberIn: () => null };

describe('pass 9 A7/C1: client patrol proof', () => {
  it('0 checkpoints: shifts + log entries still count as proof, last shift date shown, no next patrol', () => {
    const out = iso(22 * 3600e3);
    const p = siteProof(state({
      patrol_time_entries: [{ id: 't1', org_id: ORG, site_id: SITE, member_id: 'm-guard', clock_in_at: iso(30 * 3600e3), clock_out_at: out }],
      patrol_dar_entries: [{ id: 'e1', org_id: ORG, site_id: SITE, member_id: 'm-guard', occurred_at: iso(25 * 3600e3), body: 'All quiet' }],
    }), SITE)!;
    expect(p.checkpoint_count).toBe(0);
    expect(p.last_shift_at).toBe(out);
    expect(p.live.on_site).toBe('no');
    expect(p.live.next_patrol_due).toBeNull();
    const active = p.nights.filter((n) => n.shifts + n.logs > 0);
    expect(active.length).toBeGreaterThan(0);
    expect(p.nights).toHaveLength(7);
  });

  it('"on site" is yes only with a GPS-verified clock-in; never a guard name', () => {
    const base = { id: 't1', org_id: ORG, site_id: SITE, member_id: 'm-guard', clock_in_at: iso(3600e3), clock_out_at: null };
    const cps = [{ id: 'c1', site_id: SITE, org_id: ORG, name: 'Rear gate', active: true }];
    const scans = [{ id: 's1', site_id: SITE, org_id: ORG, member_id: 'm-guard', checkpoint_id: 'c1', scanned_at: iso(600e3) }];
    const runs = [{ id: 'r1', site_id: SITE, org_id: ORG, member_id: 'm-guard', started_at: iso(1200e3), expected_count: 2, scanned_count: 1 }];
    const ok = siteProof(state({ patrol_time_entries: [{ ...base, clock_in_gps_status: 'ok' }], patrol_checkpoints: cps, patrol_scans: scans, patrol_tour_runs: runs }), SITE)!;
    expect(ok.live.on_site).toBe('yes');
    expect(ok.live.last_scan).toEqual({ checkpoint: 'Rear gate', at: scans[0]!.scanned_at });
    expect(Date.parse(ok.live.next_patrol_due!)).toBe(Date.parse(runs[0]!.started_at) + 3600e3);
    expect(ok.scans).toEqual([{ checkpoint: 'Rear gate', at: scans[0]!.scanned_at }]);
    expect(JSON.stringify(ok)).not.toContain('Secret Guardname');
    expect(JSON.stringify(ok)).not.toContain('m-guard');
    for (const st of ['outside', 'unavailable', 'no_site_pin', undefined]) {
      expect(siteProof(state({ patrol_time_entries: [{ ...base, clock_in_gps_status: st }], patrol_checkpoints: cps }), SITE)!.live.on_site).toBe('unverified');
    }
  });

  it('invoices: only sent/paid, hours by day without guard names; pay link only when set', () => {
    const p = siteProof(state({
      patrol_invoices: [
        { id: 'i1', org_id: ORG, site_id: SITE, status: 'draft', invoice_no: 'D', period_month: '2026-11-01', total: 10, lines: [] },
        { id: 'i2', org_id: ORG, site_id: SITE, status: 'sent', invoice_no: 'LSS-1', period_month: '2026-10-01', due_date: '2026-11-30', total: 365, rate: 36.5,
          lines: [{ date: '2026-10-02', guard: 'Secret Guardname', hours: 6, rate: 36.5 }, { date: '2026-10-02', guard: 'Other', hours: 4, rate: 36.5 }] },
      ],
    }), SITE)!;
    expect(p.invoices.map((v) => v.invoice_no)).toEqual(['LSS-1']);
    expect(p.invoices[0]!.days).toEqual([{ date: '2026-10-02', hours: 10 }]);
    expect(JSON.stringify(p.invoices)).not.toContain('Secret Guardname');
    expect(p.pay_url).toBeNull();
  });

  it('a client request lands as an owner task and shows in the thread; other sites are refused', () => {
    const s = state();
    clientProofRpcs.patrol_client_request!(s, ctx, { p_site: SITE, p_body: 'Please check the rear gate' });
    expect(s.tables.patrol_owner_alerts!.filter((a) => a.kind === 'client_request')).toHaveLength(1);
    expect(siteProof(s, SITE)!.requests[0]!.body).toBe('Please check the rear gate');
    expect(() => clientProofRpcs.patrol_client_request!(s, ctx, { p_site: 'other', p_body: 'hello' })).toThrow();
    expect(clientProofRpcs.patrol_client_site_proof!(s, ctx, { p_site: 'other' })).toBeNull();
  });
});
