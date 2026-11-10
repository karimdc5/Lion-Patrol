// Pure helpers for the nightly client report ("Client logs"). No imports, no I/O: used by the
// patrol-client-logs edge function (Deno), the demo/memory backend and the owner UI (Vite), and
// unit-tested with vitest. Mirrors patrol_night_of / patrol_night_start / patrol_client_report_evaluate /
// patrol_client_report_items in supabase/migrations/20261110000200_patrol_client_proof.sql.
// All wall-clock output is America/Los_Angeles. Guard names never appear in client output.

export const TZ = 'America/Los_Angeles';
const DAY = 864e5;

function laParts(ms: number): { y: number; m: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute! };
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** LA wall-clock date of the moment, with the day boundary at 8:00 AM PT (a 10 PM–6 AM shift belongs to the night it started). */
export function nightOf(at: string | number | Date): string {
  const ms = new Date(at).getTime();
  const p = laParts(ms);
  // wall-clock minus 8 h (same as the SQL: (at at time zone LA) - interval '8 hours')
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - 8 * 3600e3;
  const w = new Date(wall);
  return ymd(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate());
}

/** 8:00 AM PT on the given night date, as an ISO instant. */
export function nightStart(night: string): string {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 8);
  // LA is UTC-7 or UTC-8: try both offsets, keep the one that reads 08:00 in LA.
  for (const off of [7, 8]) {
    const t = guess + off * 3600e3;
    const p = laParts(t);
    if (p.h === 8 && p.d === d) return new Date(t).toISOString();
  }
  return new Date(guess + 8 * 3600e3).toISOString();
}

export function addDays(night: string, n: number): string {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function fmtPT(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(iso));
}
export const fmtTimePT = (iso: string | null | undefined) => fmtPT(iso, { hour: 'numeric', minute: '2-digit' });
export function fmtNight(night: string): string {
  return fmtPT(nightStart(night), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ------------------------------------------------------------------ report state
export interface NightEntry { member_id?: string | null; guard?: string | null; clock_in_at: string; clock_out_at?: string | null; voided_at?: string | null; site_id?: string }
export interface NightShift { member_id?: string | null; starts_at: string; ends_at: string; cancelled_at?: string | null; site_id?: string }
export type NightState =
  | { state: 'no_activity' }
  | { state: 'waiting'; open: number; pending: number }
  | { state: 'ready'; reason: 'last_clock_out' | 'fallback_8am'; note: string | null };

/**
 * "Last scheduled guard clocked out" — same rule as patrol_client_report_evaluate:
 *  entries = non-voided clock-ins in [night 8 AM PT, next day 8 AM PT);
 *  pending = assigned, uncancelled shifts starting in the window, not yet ended, whose guard hasn't clocked in;
 *  ready when entries exist, nobody is on shift and nobody scheduled is still to come;
 *  otherwise ready at the 8 AM PT fallback with a note naming who never clocked out (owner-facing note).
 */
export function nightReportState(night: string, entries: NightEntry[], shifts: NightShift[], now: number = Date.now()): NightState {
  const start = Date.parse(nightStart(night));
  const end = Date.parse(nightStart(addDays(night, 1)));
  const inWin = (iso: string) => { const t = Date.parse(iso); return t >= start && t < end; };
  const es = entries.filter((e) => !e.voided_at && inWin(e.clock_in_at));
  const open = es.filter((e) => !e.clock_out_at);
  const pending = shifts.filter((s) => s.member_id && !s.cancelled_at && inWin(s.starts_at) && Date.parse(s.ends_at) > now
    && !es.some((e) => e.member_id === s.member_id)).length;
  if (!es.length && !pending) return { state: 'no_activity' };
  if (es.length && !open.length && !pending) return { state: 'ready', reason: 'last_clock_out', note: null };
  if (now >= end && es.length) {
    return { state: 'ready', reason: 'fallback_8am', note: open.length
      ? `${open.map((e) => e.guard || 'A guard').join(', ')} had not clocked out by 8:00 AM PT; this report covers activity until 8:00 AM PT.`
      : 'A scheduled guard had not clocked in by 8:00 AM PT.' };
  }
  return { state: 'waiting', open: open.length, pending };
}

// ------------------------------------------------------------------ merged report
/** Shape returned by patrol_client_report_items (SQL) and its memory mirror. */
export interface ReportItems {
  report: { id: string; night: string; status: string; note?: string | null; ready_reason?: string | null; [k: string]: unknown };
  site: { id?: string; name: string; address?: string | null; city?: string | null } | null;
  org: { name: string; phone?: string | null; email?: string | null } | null;
  shifts: Array<{ member_id?: string | null; guard?: string | null; clock_in_at: string; clock_out_at?: string | null }>;
  tours: Array<{ started_at: string; completed_at?: string | null; expected_count?: number | null; scanned_count?: number | null; guard?: string | null }>;
  scans: Array<{ scanned_at: string; checkpoint: string; guard?: string | null }>;
  logs: Array<{ id?: string; occurred_at: string; category?: string | null; body?: string | null; guard?: string | null; deleted_at?: string | null; photos?: string[] }>;
  incidents: Array<{ id?: string; occurred_at: string; report_no?: string | null; title?: string | null; category?: string | null; severity?: string | null;
    status?: string | null; client_visible?: boolean | null; description?: string | null; guard?: string | null; photos?: string[] }>;
}
export type LineKind = 'shift_start' | 'shift_end' | 'patrol' | 'scan' | 'log' | 'incident';
export interface ReportLine { at: string; kind: LineKind; officer: string; title: string; text: string; photos: string[] }
export interface MergedReport {
  siteName: string; orgName: string; night: string; nightLabel: string; note: string | null;
  lines: ReportLine[];
  counts: { officers: number; patrols: number; scans: number; logs: number; incidents: number; photos: number };
}

const ORDER: Record<LineKind, number> = { shift_start: 0, patrol: 1, scan: 2, log: 3, incident: 4, shift_end: 5 };

/**
 * One combined, client-safe report: every guard's patrols, checkpoint scans, log entries, incidents and
 * photos merged in time order. Internal-only (not client-visible) and draft incidents are dropped, deleted
 * log entries are dropped, and guard names are replaced with "Officer 1", "Officer 2", …
 * The owner preview shows exactly this, so what he approves is what the client receives.
 */
export function mergeNightReport(items: ReportItems): MergedReport {
  const officers = new Map<string, string>();
  const officer = (name?: string | null) => {
    const k = (name || '').trim() || '?';
    if (!officers.has(k)) officers.set(k, `Officer ${officers.size + 1}`);
    return officers.get(k)!;
  };
  for (const s of [...items.shifts].sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at))) officer(s.guard);
  const lines: ReportLine[] = [];
  for (const s of items.shifts) {
    const o = officer(s.guard);
    lines.push({ at: s.clock_in_at, kind: 'shift_start', officer: o, title: 'On duty', text: `${o} started the shift`, photos: [] });
    if (s.clock_out_at) lines.push({ at: s.clock_out_at, kind: 'shift_end', officer: o, title: 'Off duty', text: `${o} ended the shift`, photos: [] });
  }
  for (const t of items.tours) {
    const exp = Number(t.expected_count ?? 0); const got = Math.min(Number(t.scanned_count ?? 0), exp);
    lines.push({ at: t.started_at, kind: 'patrol', officer: officer(t.guard), title: 'Patrol round',
      text: exp ? `${got}/${exp} checkpoints${t.completed_at ? ', completed' : ''}` : 'Patrol round', photos: [] });
  }
  for (const s of items.scans) lines.push({ at: s.scanned_at, kind: 'scan', officer: officer(s.guard), title: 'Checkpoint', text: s.checkpoint, photos: [] });
  for (const l of items.logs) {
    if (l.deleted_at) continue;
    lines.push({ at: l.occurred_at, kind: 'log', officer: officer(l.guard), title: l.category || 'Log entry', text: (l.body ?? '').trim(), photos: l.photos ?? [] });
  }
  for (const i of items.incidents) {
    if (!i.client_visible || i.status === 'draft') continue;
    const head = [i.report_no, i.severity ? `severity ${i.severity}` : null].filter(Boolean).join(' · ');
    lines.push({ at: i.occurred_at, kind: 'incident', officer: officer(i.guard), title: `Incident: ${i.title || i.category || 'Incident'}`,
      text: [head, (i.description ?? '').trim()].filter(Boolean).join('\n'), photos: i.photos ?? [] });
  }
  lines.sort((a, b) => a.at.localeCompare(b.at) || ORDER[a.kind] - ORDER[b.kind]);
  const night = String(items.report.night);
  return {
    siteName: items.site?.name ?? 'Your site', orgName: items.org?.name ?? '', night, nightLabel: fmtNight(night),
    note: clientNote(items.report.ready_reason ?? null),
    lines,
    counts: {
      officers: new Set(items.shifts.map((s) => officer(s.guard))).size,
      patrols: items.tours.length, scans: items.scans.length,
      logs: lines.filter((l) => l.kind === 'log').length, incidents: lines.filter((l) => l.kind === 'incident').length,
      photos: lines.reduce((n, l) => n + l.photos.length, 0),
    },
  };
}

/** The owner-facing note names guards; the client only learns that the report was closed at 8 AM PT. */
function clientNote(reason: string | null): string | null {
  return reason === 'fallback_8am' ? 'This report was closed at 8:00 AM PT and covers activity up to that time.' : null;
}

/** Plain-text email body (the edge function also sends an HTML version of the same content). */
export function renderReportText(r: MergedReport): { subject: string; text: string } {
  const subject = `Nightly patrol report — ${r.siteName} — ${r.nightLabel}`;
  const c = r.counts;
  const out = [
    `${r.siteName} — night of ${r.nightLabel}`,
    `${c.officers} officer${c.officers === 1 ? '' : 's'} · ${c.patrols} patrol round${c.patrols === 1 ? '' : 's'} · ${c.scans} checkpoint scan${c.scans === 1 ? '' : 's'} · ${c.logs} log entr${c.logs === 1 ? 'y' : 'ies'} · ${c.incidents} incident${c.incidents === 1 ? '' : 's'} · ${c.photos} photo${c.photos === 1 ? '' : 's'}`,
    ...(r.note ? ['', r.note] : []),
    '',
    'All times Pacific (America/Los_Angeles).',
    '',
    ...r.lines.map((l) => `${fmtTimePT(l.at)}  ${l.title} — ${l.text.replace(/\n/g, ' / ')}${l.photos.length ? ` [${l.photos.length} photo${l.photos.length > 1 ? 's' : ''}]` : ''}`),
    ...(r.lines.length ? [] : ['No activity recorded.']),
    '',
    `— ${r.orgName || 'Lion Security Services'}`,
  ];
  return { subject, text: out.join('\n') };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export function renderReportHtml(r: MergedReport): string {
  const rows = r.lines.map((l) => `<tr><td style="padding:4px 8px;white-space:nowrap;vertical-align:top">${escapeHtml(fmtTimePT(l.at))}</td><td style="padding:4px 8px"><b>${escapeHtml(l.title)}</b><br>${escapeHtml(l.text).replace(/\n/g, '<br>')}${l.photos.length ? `<br><i>${l.photos.length} photo${l.photos.length > 1 ? 's' : ''} on file</i>` : ''}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px"><h2 style="margin:0">${escapeHtml(r.siteName)}</h2><p>Night of ${escapeHtml(r.nightLabel)} · all times Pacific</p>${r.note ? `<p><i>${escapeHtml(r.note)}</i></p>` : ''}<table>${rows || '<tr><td>No activity recorded.</td></tr>'}</table><p>— ${escapeHtml(r.orgName || 'Lion Security Services')}</p></div>`;
}

// ------------------------------------------------------------------ mail (pure: config, message, provider request)
export const MAIL_FROM_ADDRESS = 'contact@lionofseattle.com';
export type MailProvider = 'resend' | 'postmark';
export interface MailConfig {
  configured: boolean; missing: string[]; provider: MailProvider | null; mode: 'live' | 'dry_run';
  from: string; apiKey: string | null; testTo: string | null;
}

/**
 * Reads only secret NAMES documented in docs/PASS9-backend-setup.md. Missing provider/key → not configured
 * (rows are marked "not_configured", never "sent"). Anything but CLIENT_MAIL_MODE=live is a dry run.
 */
export function mailConfig(env: Record<string, string | undefined>): MailConfig {
  const provider = (env.CLIENT_MAIL_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = (env.CLIENT_MAIL_API_KEY ?? '').trim() || null;
  const missing: string[] = [];
  if (provider !== 'resend' && provider !== 'postmark') missing.push('CLIENT_MAIL_PROVIDER');
  if (!apiKey) missing.push('CLIENT_MAIL_API_KEY');
  const name = (env.CLIENT_MAIL_FROM_NAME ?? '').replace(/[<>"\r\n]/g, '').trim() || 'Lion Security Services';
  const testTo = (env.CLIENT_MAIL_TEST_TO ?? '').trim().toLowerCase() || null;
  return { configured: !missing.length, missing, provider: missing.includes('CLIENT_MAIL_PROVIDER') ? null : (provider as MailProvider), mode: env.CLIENT_MAIL_MODE === 'live' ? 'live' : 'dry_run',
    from: `${name} <${MAIL_FROM_ADDRESS}>`, apiKey, testTo };
}

export interface OutboxRow { id: string; kind: string; subject: string; body_text: string; recipients: string[]; ref_id?: string | null }
export interface MailMessage { to: string[]; subject: string; text: string; html: string }

/** Final message for one outbox row. Client logs are rendered from the merged report; other kinds use the queued text. */
export function buildMessage(row: OutboxRow, merged: MergedReport | null, cfg: Pick<MailConfig, 'testTo'>): MailMessage | null {
  const to = cfg.testTo ? [cfg.testTo] : [...new Set(row.recipients.map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
  if (!to.length) return null;
  if (row.kind === 'client_log' && merged) {
    const { subject, text } = renderReportText(merged);
    return { to, subject: row.subject || subject, text, html: renderReportHtml(merged) };
  }
  return { to, subject: row.subject, text: row.body_text, html: `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(row.body_text)}</div>` };
}

/** HTTP request for the provider (the function does the fetch; tests only inspect this). */
export function providerRequest(cfg: MailConfig, msg: MailMessage): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  if (cfg.provider === 'postmark') {
    return { url: 'https://api.postmarkapp.com/email', init: { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Postmark-Server-Token': cfg.apiKey ?? '' },
      body: JSON.stringify({ From: cfg.from, To: msg.to.join(','), Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html, MessageStream: 'outbound' }) } };
  }
  return { url: 'https://api.resend.com/emails', init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey ?? ''}` },
    body: JSON.stringify({ from: cfg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }) } };
}
