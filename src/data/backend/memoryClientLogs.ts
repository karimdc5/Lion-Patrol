import { uuidv7 } from '../../lib/uuid';
import { nightOf, nightStart, addDays, nightReportState, fmtPT, type ReportItems } from '../../../supabase/functions/_shared/client-logs';
import { BackendError } from './types';
import type { ClientCtx } from './memoryClient';

/**
 * Pass 9 chunk 2 (Client logs + A12): memory/demo mirror of the outbox and nightly report functions in
 * supabase/migrations/20261110000200_patrol_client_proof.sql. Nothing here sends email: rows are queued
 * and the owner UI reports the honest "not configured" state (demo has no edge function).
 */
type R = Record<string, any> & { id: string };
type S = { tables: Record<string, R[]> };
const nowIso = () => new Date().toISOString();
const t = (s: S, name: string) => (s.tables[name] ??= []);
const siteName = (s: S, id: string) => t(s, 'patrol_sites').find((x) => x.id === id)?.name ?? 'your site';
const dateLabel = (d: string) => fmtPT(nightStart(d), { month: 'short', day: '2-digit', year: 'numeric' });

export function queueClientEmail(s: S, org: string, site: string | null, kind: string, ref: string | null, dedupe: string, subject: string, body: string, force = false, by: string | null = null): string | null {
  if (!force) {
    const set = t(s, 'patrol_site_client_email').find((x) => x.site_id === site);
    const on = ({ incident: set?.notify_incident, missed_patrol: set?.notify_missed_patrol, dar: set?.notify_dar, invoice: set?.notify_invoice } as Record<string, unknown>)[kind] ?? true;
    if (!on) return null;
  }
  const list = t(s, 'patrol_client_emails');
  if (list.some((e) => e.org_id === org && e.dedupe_key === dedupe)) return null;
  const id = uuidv7();
  list.push({ id, org_id: org, site_id: site, kind, ref_id: ref, dedupe_key: dedupe, subject: subject.slice(0, 200), body_text: body.slice(0, 8000), status: 'queued',
    attempts: 0, error: null, provider_id: null, sent_to: [], queued_by: by, created_at: nowIso(), updated_at: nowIso(), sent_at: null });
  return id;
}

function reportQueue(s: S, id: string, by: string | null = null): string | null {
  const r = t(s, 'patrol_client_reports').find((x) => x.id === id)!;
  const email = queueClientEmail(s, r.org_id, r.site_id, 'client_log', r.id, `log:${r.id}:${r.send_count + 1}`,
    `Nightly patrol report — ${siteName(s, r.site_id)} — ${dateLabel(r.night)}`, '', true, by);
  Object.assign(r, { status: 'queued', send_count: r.send_count + 1, last_email_id: email, last_error: null, updated_at: nowIso() });
  return email;
}

/** Mirror of patrol_client_report_evaluate (called after every clock-in / clock-out / void). */
export function evaluateNight(s: S, siteId: string, night: string): string {
  const site = t(s, 'patrol_sites').find((x) => x.id === siteId);
  if (!site) return 'no_site';
  const names = (id: string) => t(s, 'patrol_members').find((m) => m.id === id)?.display_name ?? null;
  const entries = t(s, 'patrol_time_entries').filter((x) => x.site_id === siteId).map((x) => ({ ...x, guard: names(x.member_id) })) as any[];
  const st = nightReportState(night, entries, t(s, 'patrol_shifts').filter((x) => x.site_id === siteId) as any[]);
  if (st.state === 'no_activity') return 'no_activity';
  const list = t(s, 'patrol_client_reports');
  let r = list.find((x) => x.site_id === siteId && x.night === night);
  if (!r) {
    r = { id: uuidv7(), org_id: site.org_id, site_id: siteId, night, status: 'waiting', ready_reason: null, note: null, ready_at: null, approved_by: null, approved_at: null,
      sent_at: null, send_count: 0, last_email_id: null, last_error: null, created_at: nowIso(), updated_at: nowIso() };
    list.push(r);
  }
  if (r.status !== 'waiting') return r.status;
  if (st.state === 'waiting') return 'waiting';
  Object.assign(r, { status: 'ready', ready_reason: st.reason, note: st.note, ready_at: nowIso(), updated_at: nowIso() });
  if (t(s, 'patrol_site_client_email').find((x) => x.site_id === siteId)?.auto_send_logs) { reportQueue(s, r.id); return 'queued'; }
  queueClientEmail(s, site.org_id, siteId, 'owner_ping', r.id, `ping:${r.id}`, `Ready for your OK: nightly report — ${site.name} — ${dateLabel(night)}`,
    `The combined nightly client report for ${site.name} (${dateLabel(night)}) is ready. Open Lion Patrol → Client logs to preview it and press Send.`, true);
  return 'ready';
}

export function onTimeEntryWrite(s: S, row: R) {
  try { evaluateNight(s, row.site_id, nightOf(row.clock_in_at)); } catch { /* never blocks the clock action */ }
}
export function onIncidentSent(s: S, inc: R) {
  if (!inc.client_visible) return;
  queueClientEmail(s, inc.org_id, inc.site_id, 'incident', inc.id, `inc:${inc.id}`, `Incident report ${inc.report_no ?? ''} — ${siteName(s, inc.site_id)}`,
    `${inc.title || inc.category_name || 'Incident'}\nSeverity: ${inc.severity}\nOccurred: ${fmtPT(inc.occurred_at)} PT\n\n${String(inc.description ?? '').slice(0, 3000)}`);
}
export function onDarShared(s: S, d: R) {
  if (!d.client_visible || d.status === 'open') return;
  queueClientEmail(s, d.org_id, d.site_id, 'dar', d.id, `dar:${d.id}`, `Daily activity report ${dateLabel(d.report_date)} — ${siteName(s, d.site_id)}`,
    `Your daily activity report for ${dateLabel(d.report_date)} is ready${d.report_no ? ` (${d.report_no})` : ''}.\n\n${String(d.summary ?? '').slice(0, 3000)}`);
}

export function reportItems(s: S, id: string): ReportItems | null {
  const r = t(s, 'patrol_client_reports').find((x) => x.id === id);
  if (!r) return null;
  const start = nightStart(r.night); const end = nightStart(addDays(r.night, 1));
  const inWin = (iso: string) => { const x = Date.parse(iso); return x >= Date.parse(start) && x < Date.parse(end); };
  const name = (mid: string) => t(s, 'patrol_members').find((m) => m.id === mid)?.display_name ?? 'Guard';
  const site = t(s, 'patrol_sites').find((x) => x.id === r.site_id);
  const org = t(s, 'patrol_orgs').find((x) => x.id === r.org_id);
  const img = (type: string, pid: string) => t(s, 'patrol_attachments').filter((a) => a.parent_type === type && a.parent_id === pid && a.kind === 'image' && a.upload_status === 'uploaded').map((a) => a.storage_path as string);
  const by = (k: string) => (a: R, b: R) => String(a[k]).localeCompare(String(b[k]));
  return {
    report: { ...r } as ReportItems['report'],
    site: site ? { id: site.id, name: site.name, address: site.address ?? null, city: site.city ?? null } : null,
    org: org ? { name: org.name, phone: org.phone ?? null, email: org.email ?? null } : null,
    shifts: t(s, 'patrol_time_entries').filter((x) => x.site_id === r.site_id && !x.voided_at && inWin(x.clock_in_at)).sort(by('clock_in_at'))
      .map((x) => ({ member_id: x.member_id, guard: name(x.member_id), clock_in_at: x.clock_in_at, clock_out_at: x.clock_out_at ?? null })),
    tours: t(s, 'patrol_tour_runs').filter((x) => x.site_id === r.site_id && inWin(x.started_at)).sort(by('started_at'))
      .map((x) => ({ started_at: x.started_at, completed_at: x.completed_at ?? null, expected_count: x.expected_count, scanned_count: x.scanned_count, guard: name(x.member_id) })),
    scans: t(s, 'patrol_scans').filter((x) => x.site_id === r.site_id && inWin(x.scanned_at)).sort(by('scanned_at'))
      .map((x) => ({ scanned_at: x.scanned_at, checkpoint: t(s, 'patrol_checkpoints').find((c) => c.id === x.checkpoint_id)?.name ?? 'Checkpoint', guard: name(x.member_id) })),
    logs: t(s, 'patrol_dar_entries').filter((x) => x.site_id === r.site_id && !x.deleted_at && inWin(x.occurred_at)).sort(by('occurred_at'))
      .map((x) => ({ id: x.id, occurred_at: x.occurred_at, category: x.category_name ?? null, body: x.body ?? null, guard: name(x.member_id), photos: img('dar_entry', x.id) })),
    incidents: t(s, 'patrol_incidents').filter((x) => x.site_id === r.site_id && x.client_visible && x.status !== 'draft' && inWin(x.occurred_at)).sort(by('occurred_at'))
      .map((x) => ({ id: x.id, occurred_at: x.occurred_at, report_no: x.report_no, title: x.title || x.category_name, category: x.category_name, severity: x.severity, status: x.status,
        client_visible: x.client_visible, description: x.description, guard: x.author_name, photos: img('incident', x.id) })),
  };
}

export const clientLogRpcs: Record<string, (s: S, c: ClientCtx, a: Record<string, any>) => unknown> = {
  patrol_client_report_items(s, c, a) {
    const r = t(s, 'patrol_client_reports').find((x) => x.id === a.p_id);
    if (!r || !c.adminOrgs.includes(r.org_id)) return null;
    return reportItems(s, r.id);
  },
  patrol_client_report_send(s, c, a) {
    const r = t(s, 'patrol_client_reports').find((x) => x.id === a.p_id);
    if (!r || !c.adminOrgs.includes(r.org_id)) throw new BackendError('42501', 'not_found', 403);
    if (['waiting', 'queued', 'sending'].includes(r.status)) throw new BackendError('23514', 'report_not_ready', 400);
    const email = reportQueue(s, r.id, c.memberIn(r.org_id));
    Object.assign(r, { approved_by: c.memberIn(r.org_id), approved_at: nowIso() });
    return email;
  },
  patrol_client_email_unavailable(s, c, a) {
    const e = t(s, 'patrol_client_emails').find((x) => x.id === a.p_id);
    if (!e || !c.adminOrgs.includes(e.org_id)) throw new BackendError('42501', 'not_found', 403);
    if (e.status !== 'queued') return null;
    Object.assign(e, { status: 'not_configured', error: String(a.p_reason ?? 'Email sending is not configured').slice(0, 300), updated_at: nowIso() });
    if (e.kind === 'client_log') {
      const r = t(s, 'patrol_client_reports').find((x) => x.id === e.ref_id && x.last_email_id === e.id);
      if (r) Object.assign(r, { status: 'not_configured', last_error: String(a.p_reason ?? '').slice(0, 300), updated_at: nowIso() });
    }
    return null;
  },
  patrol_invoice_send(s, c, a) {
    const v = t(s, 'patrol_invoices').find((x) => x.id === a.p_id);
    if (!v || !c.adminOrgs.includes(v.org_id)) throw new BackendError('42501', 'not_found', 403);
    if (v.status === 'void') throw new BackendError('23514', 'invoice_void', 400);
    if (!(Number(v.total) > 0)) throw new BackendError('23514', 'invoice_zero', 400);
    const set = t(s, 'patrol_site_client_email').find((x) => x.site_id === v.site_id);
    if (!set?.notify_invoice) throw new BackendError('23514', 'invoice_email_off', 400);
    const bill = t(s, 'patrol_site_billing').find((x) => x.site_id === v.site_id);
    if (!(set.recipients ?? []).length && !String(bill?.client_email ?? '').trim()) throw new BackendError('23514', 'no_client_email', 400);
    const n = t(s, 'patrol_client_emails').filter((e) => e.kind === 'invoice' && e.ref_id === v.id).length;
    const ob = t(s, 'patrol_org_billing').find((x) => x.org_id === v.org_id);
    return queueClientEmail(s, v.org_id, v.site_id, 'invoice', v.id, `invoice:${v.id}:${n + 1}`, `Invoice ${v.invoice_no} — ${siteName(s, v.site_id)}`,
      `Invoice ${v.invoice_no}. Amount due: $${Number(v.total).toFixed(2)}. Due date: ${v.due_date}.\n\n${ob?.pay_url ? `Pay online: ${ob.pay_url}` : `Online payment is not set up. ${ob?.payment_note ?? ''} ${ob?.payment_details ?? ''}`}`, true, c.memberIn(v.org_id));
  },
};
