import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { nightOf, nightStart, addDays, nightReportState, mergeNightReport, renderReportText, renderReportHtml, mailConfig, buildMessage, providerRequest,
  MAIL_FROM_ADDRESS, type ReportItems } from '../../supabase/functions/_shared/client-logs';

// Pure helpers of supabase/functions/_shared/client-logs.ts. No network: fetch is stubbed to throw.
beforeAll(() => { vi.stubGlobal('fetch', () => { throw new Error('network is not allowed in unit tests'); }); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('night window (8:00 AM PT boundary, America/Los_Angeles)', () => {
  it('a 10 PM–6 AM shift belongs to the night it started', () => {
    expect(nightOf('2026-11-08T06:00:00Z')).toBe('2026-11-07');  // Nov 7 10:00 PM PST
    expect(nightOf('2026-11-08T14:00:00Z')).toBe('2026-11-07');  // Nov 8 6:00 AM PST
    expect(nightOf('2026-11-08T16:00:00Z')).toBe('2026-11-08');  // Nov 8 8:00 AM PST → next night
  });
  it('night start is 8:00 AM PT in both PST and PDT', () => {
    expect(nightStart('2026-11-08')).toBe('2026-11-08T16:00:00.000Z'); // PST (UTC-8)
    expect(nightStart('2026-07-04')).toBe('2026-07-04T15:00:00.000Z'); // PDT (UTC-7)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('nightReportState (mirrors patrol_client_report_evaluate)', () => {
  const night = '2026-11-07';
  const at = (h: number) => new Date(Date.parse(nightStart(night)) + h * 3600e3).toISOString();
  const during = Date.parse(at(20));
  it('no activity → nothing', () => expect(nightReportState(night, [], [], during)).toEqual({ state: 'no_activity' }));
  it('waits while any guard is on shift; ready after the LAST clock-out (1–4 guards = one report)', () => {
    const e = [{ member_id: 'a', clock_in_at: at(14), clock_out_at: at(18) }, { member_id: 'b', clock_in_at: at(15), clock_out_at: null }];
    expect(nightReportState(night, e, [], during).state).toBe('waiting');
    expect(nightReportState(night, [e[0]!, { ...e[1]!, clock_out_at: at(21) }], [], during)).toEqual({ state: 'ready', reason: 'last_clock_out', note: null });
  });
  it('waits for a scheduled guard who has not clocked in yet', () => {
    const e = [{ member_id: 'a', clock_in_at: at(14), clock_out_at: at(18) }];
    const s = [{ member_id: 'b', starts_at: at(19), ends_at: at(23) }];
    expect(nightReportState(night, e, s, during)).toMatchObject({ state: 'waiting', pending: 1 });
    expect(nightReportState(night, e, [{ ...s[0]!, cancelled_at: at(1) }], during).state).toBe('ready');
  });
  it('8 AM PT fallback with an owner note naming who never clocked out', () => {
    const e = [{ member_id: 'a', guard: 'Sam', clock_in_at: at(14), clock_out_at: null }];
    expect(nightReportState(night, e, [], Date.parse(at(24)) + 1)).toEqual({ state: 'ready', reason: 'fallback_8am', note: 'Sam had not clocked out by 8:00 AM PT; this report covers activity until 8:00 AM PT.' });
  });
  it('voided entries do not count', () => {
    expect(nightReportState(night, [{ member_id: 'a', clock_in_at: at(14), clock_out_at: at(16), voided_at: at(17) }], [], during)).toEqual({ state: 'no_activity' });
  });
});

const items: ReportItems = {
  report: { id: 'r1', night: '2026-11-07', status: 'ready', ready_reason: 'fallback_8am', note: 'Sam Guard had not clocked out by 8:00 AM PT' },
  site: { name: 'Trailside' }, org: { name: 'Lion Security Services' },
  shifts: [{ member_id: 'b', guard: 'Bea Guard', clock_in_at: '2026-11-08T07:00:00Z', clock_out_at: '2026-11-08T13:00:00Z' }, { member_id: 'a', guard: 'Sam Guard', clock_in_at: '2026-11-08T06:00:00Z', clock_out_at: null }],
  tours: [{ started_at: '2026-11-08T08:00:00Z', expected_count: 3, scanned_count: 4, completed_at: '2026-11-08T08:20:00Z', guard: 'Sam Guard' }],
  scans: [{ scanned_at: '2026-11-08T08:05:00Z', checkpoint: 'Rear gate', guard: 'Sam Guard' }],
  logs: [{ occurred_at: '2026-11-08T09:00:00Z', category: 'Patrol', body: 'All quiet', guard: 'Bea Guard', photos: ['p/1.jpg'] },
    { occurred_at: '2026-11-08T09:30:00Z', category: 'Patrol', body: 'deleted', guard: 'Bea Guard', deleted_at: '2026-11-08T10:00:00Z' }],
  incidents: [
    { occurred_at: '2026-11-08T10:00:00Z', report_no: 'LSS-TS-2026-00010', title: 'Person tagging rear fence', severity: 'medium', status: 'sent_to_client', client_visible: true, description: 'Tagging seen', guard: 'Sam Guard', photos: ['p/2.jpg'] },
    { occurred_at: '2026-11-08T11:00:00Z', title: 'INTERNAL ONLY', severity: 'low', status: 'reviewed', client_visible: false, description: 'secret', guard: 'Sam Guard' },
  ],
};

describe('mergeNightReport', () => {
  const r = mergeNightReport(items);
  it('merges every guard in time order, drops internal-only incidents and deleted logs', () => {
    expect(r.lines.map((l) => l.kind)).toEqual(['shift_start', 'shift_start', 'patrol', 'scan', 'log', 'incident', 'shift_end']);
    expect(r.lines.map((l) => l.at)).toEqual([...r.lines.map((l) => l.at)].sort());
    expect(JSON.stringify(r)).not.toContain('INTERNAL ONLY');
    expect(JSON.stringify(r)).not.toContain('deleted');
    expect(r.counts).toEqual({ officers: 2, patrols: 1, scans: 1, logs: 1, incidents: 1, photos: 2 });
    expect(r.lines.find((l) => l.kind === 'patrol')!.text).toBe('3/3 checkpoints, completed');
  });
  it('never contains guard names (Officer 1/2 by first clock-in) or the owner note', () => {
    const all = JSON.stringify(r) + renderReportText(r).text + renderReportHtml(r);
    expect(all).not.toMatch(/Sam|Bea/);
    expect(r.lines[0]!.officer).toBe('Officer 1');
    expect(r.note).toBe('This report was closed at 8:00 AM PT and covers activity up to that time.');
  });
  it('renders PT times and a subject per site/night', () => {
    const t = renderReportText(r);
    expect(t.subject).toBe('Nightly patrol report — Trailside — Sat, Nov 7, 2026');
    expect(t.text).toContain('10:00 PM  On duty');   // 06:00Z = 10:00 PM PST
    expect(t.text).toContain('All times Pacific');
    expect(renderReportHtml({ ...r, siteName: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('mail config + messages (never sends)', () => {
  it('missing provider or key → not configured; default is dry run; always from contact@lionofseattle.com', () => {
    const none = mailConfig({});
    expect(none).toMatchObject({ configured: false, missing: ['CLIENT_MAIL_PROVIDER', 'CLIENT_MAIL_API_KEY'], mode: 'dry_run' });
    const ok = mailConfig({ CLIENT_MAIL_PROVIDER: 'Resend', CLIENT_MAIL_API_KEY: 'k' });
    expect(ok).toMatchObject({ configured: true, provider: 'resend', mode: 'dry_run' });
    expect(ok.from).toBe(`Lion Security Services <${MAIL_FROM_ADDRESS}>`);
    expect(mailConfig({ CLIENT_MAIL_PROVIDER: 'sendgrid', CLIENT_MAIL_API_KEY: 'k' }).configured).toBe(false);
    expect(mailConfig({ CLIENT_MAIL_PROVIDER: 'postmark', CLIENT_MAIL_API_KEY: 'k', CLIENT_MAIL_MODE: 'live' }).mode).toBe('live');
    expect(mailConfig({ CLIENT_MAIL_FROM_NAME: 'Evil <x@y.z>' }).from).toBe(`Evil x@y.z <${MAIL_FROM_ADDRESS}>`);
  });
  it('recipients: invalid dropped, none → null, test address overrides everyone', () => {
    const row = { id: 'e1', kind: 'incident', subject: 'S', body_text: 'B <x>', recipients: ['A@Example.com', 'nope', 'a@example.com'] };
    expect(buildMessage(row, null, { testTo: null })).toMatchObject({ to: ['a@example.com'], subject: 'S', text: 'B <x>' });
    expect(buildMessage(row, null, { testTo: null })!.html).toContain('B &lt;x&gt;');
    expect(buildMessage({ ...row, recipients: ['nope'] }, null, { testTo: null })).toBeNull();
    expect(buildMessage(row, null, { testTo: 'owner@test.invalid' })!.to).toEqual(['owner@test.invalid']);
    const log = buildMessage({ ...row, kind: 'client_log', subject: '' }, mergeNightReport(items), { testTo: null })!;
    expect(log.subject).toContain('Trailside');
    expect(log.text).not.toContain('Sam');
  });
  it('provider requests are built, not sent', () => {
    const msg = { to: ['a@example.com'], subject: 'S', text: 'T', html: 'H' };
    const resend = providerRequest(mailConfig({ CLIENT_MAIL_PROVIDER: 'resend', CLIENT_MAIL_API_KEY: 'k1' }), msg);
    expect(resend.url).toBe('https://api.resend.com/emails');
    expect(resend.init.headers.Authorization).toBe('Bearer k1');
    expect(JSON.parse(resend.init.body)).toMatchObject({ from: `Lion Security Services <${MAIL_FROM_ADDRESS}>`, to: ['a@example.com'] });
    const pm = providerRequest(mailConfig({ CLIENT_MAIL_PROVIDER: 'postmark', CLIENT_MAIL_API_KEY: 'k2' }), msg);
    expect(pm.url).toBe('https://api.postmarkapp.com/email');
    expect(pm.init.headers['X-Postmark-Server-Token']).toBe('k2');
  });
});
