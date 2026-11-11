import { uuidv7 } from '../../lib/uuid';
import { nightOf, addDays } from '../../../supabase/functions/_shared/client-logs';
import { BackendError } from './types';

/**
 * Pass 9 chunk 2 (A7/C1): memory/demo mirror of patrol_site_proof, patrol_client_site_proof and the
 * client request thread in supabase/migrations/20261110000200_patrol_client_proof.sql.
 * Guard names, pay and schedules are never part of the proof payload.
 */
type R = Record<string, any> & { id: string };
type S = { tables: Record<string, R[]> };
export interface ClientCtx { memberIds: string[]; clientSites: string[]; staffOrgs: string[]; adminOrgs: string[]; members: R[]; memberIn: (org: string) => string | null }
const nowIso = () => new Date().toISOString();
const t = (s: S, name: string) => (s.tables[name] ??= []);

export function siteProof(s: S, siteId: string, now = Date.now()) {
  const site = t(s, 'patrol_sites').find((x) => x.id === siteId);
  if (!site) return null;
  const settings = t(s, 'patrol_org_settings').find((x) => x.org_id === site.org_id);
  const interval = Number(site.tour_interval_min ?? settings?.tour_interval_min ?? 60);
  const cps = t(s, 'patrol_checkpoints').filter((c) => c.site_id === siteId && c.active !== false);
  const cpName = (id: string) => t(s, 'patrol_checkpoints').find((c) => c.id === id)?.name ?? 'Checkpoint';
  const te = t(s, 'patrol_time_entries')
    .filter((x) => x.site_id === siteId && !x.clock_out_at && !x.voided_at && Date.parse(x.clock_in_at) > now - 16 * 3600e3)
    .sort((a, b) => Number(b.clock_in_gps_status === 'ok') - Number(a.clock_in_gps_status === 'ok') || b.clock_in_at.localeCompare(a.clock_in_at))[0];
  const runs = t(s, 'patrol_tour_runs').filter((r) => r.site_id === siteId);
  const lastRun = te ? runs.filter((r) => r.started_at >= te.clock_in_at).map((r) => r.started_at as string).sort().at(-1) : undefined;
  const scans = t(s, 'patrol_scans').filter((x) => x.site_id === siteId).sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
  const today = nightOf(now);
  const sumRuns = (rs: R[]) => ({ expected: rs.reduce((n, r) => n + Number(r.expected_count ?? 0), 0), scanned: rs.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0) });
  const entries = t(s, 'patrol_time_entries').filter((x) => x.site_id === siteId && !x.voided_at);
  const logs = t(s, 'patrol_dar_entries').filter((e) => e.site_id === siteId && !e.deleted_at);
  const lastShift = entries.map((x) => (x.clock_out_at ?? x.clock_in_at) as string).sort().at(-1) ?? null;
  const incidents = t(s, 'patrol_incidents').filter((i) => i.site_id === siteId && i.client_visible && i.status !== 'draft' && Date.parse(i.occurred_at) > now - 180 * 864e5);
  const imgs = (id: string) => t(s, 'patrol_attachments').filter((a) => a.parent_type === 'incident' && a.parent_id === id && a.kind === 'image');
  const billing = t(s, 'patrol_org_billing').find((b) => b.org_id === site.org_id);
  return {
    checkpoint_count: cps.length,
    live: {
      on_site: !te ? 'no' : te.clock_in_gps_status === 'ok' ? 'yes' : 'unverified',
      since: te?.clock_in_at ?? null,
      last_scan: scans[0] ? { checkpoint: cpName(scans[0].checkpoint_id), at: scans[0].scanned_at } : null,
      next_patrol_due: te && cps.length ? new Date(Date.parse(lastRun ?? te.clock_in_at) + interval * 60e3).toISOString() : null,
      today: sumRuns(runs.filter((r) => nightOf(r.started_at) === today)),
    },
    last_shift_at: lastShift,
    scans: scans.filter((x) => Date.parse(x.scanned_at) > now - 7 * 864e5).slice(0, 150).map((x) => ({ checkpoint: cpName(x.checkpoint_id), at: x.scanned_at })),
    nights: Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((night) => ({
      night,
      shifts: entries.filter((x) => nightOf(x.clock_in_at) === night).length,
      scans: scans.filter((x) => nightOf(x.scanned_at) === night).length,
      logs: logs.filter((e) => nightOf(e.occurred_at) === night).length,
      ...sumRuns(runs.filter((r) => nightOf(r.started_at) === night)),
    })),
    incident_media: incidents.map((i) => ({
      incident_id: i.id,
      photos: imgs(i.id).filter((a) => a.upload_status === 'uploaded').map((a) => ({ path: a.storage_path, thumb: a.thumb_path ?? null })),
      photos_pending: imgs(i.id).filter((a) => a.upload_status !== 'uploaded').length,
      follow_up: t(s, 'patrol_incident_events').filter((e) => e.incident_id === i.id && e.kind === 'status').sort((a, b) => a.created_at.localeCompare(b.created_at)).map((e) => ({ at: e.created_at, status: e.to_status })),
    })),
    invoices: t(s, 'patrol_invoices').filter((v) => v.site_id === siteId && ['sent', 'paid'].includes(v.status)).sort((a, b) => String(b.period_month).localeCompare(String(a.period_month))).map((v) => {
      const lines = (v.lines ?? []) as Array<{ date: string; hours: number }>;
      const days = new Map<string, number>();
      for (const l of lines) days.set(l.date, (days.get(l.date) ?? 0) + Number(l.hours ?? 0));
      return { id: v.id, invoice_no: v.invoice_no, status: v.status, issue_date: v.issue_date, due_date: v.due_date, period_month: v.period_month, total: v.total, rate: v.rate,
        sent_at: v.sent_at ?? null, paid_at: v.paid_at ?? null, hours: lines.reduce((n, l) => n + Number(l.hours ?? 0), 0),
        days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => ({ date, hours })) };
    }),
    pay_url: String(billing?.pay_url ?? '').trim() || null,
    requests: t(s, 'patrol_client_requests').filter((q) => q.site_id === siteId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)
      .map((q) => ({ id: q.id, body: q.body, created_at: q.created_at, status: q.status, reply: q.reply ?? null, replied_at: q.replied_at ?? null, contact_name: q.contact_name ?? null })),
  };
}

function addRequest(s: S, siteId: string, source: 'portal' | 'client', link: string | null, member: string | null, name: string | null, body: string) {
  const site = t(s, 'patrol_sites').find((x) => x.id === siteId);
  if (!site) throw new BackendError('42501', 'not_found', 403);
  const text = String(body ?? '').trim();
  if (text.length < 3) throw new BackendError('23514', 'request_too_short', 400);
  if (t(s, 'patrol_client_requests').filter((q) => q.site_id === siteId && Date.parse(q.created_at) > Date.now() - 864e5).length >= 20) throw new BackendError('54000', 'too_many_requests', 429);
  const id = uuidv7();
  t(s, 'patrol_client_requests').push({ id, org_id: site.org_id, site_id: siteId, source, portal_link_id: link, member_id: member, contact_name: String(name ?? '').trim().slice(0, 80) || null,
    body: text.slice(0, 2000), status: 'open', reply: null, replied_by: null, replied_at: null, created_at: nowIso(), updated_at: nowIso() });
  // Lands as an owner task (owner/admin alert list on Live).
  t(s, 'patrol_owner_alerts').push({ id: uuidv7(), org_id: site.org_id, kind: 'client_request', dedupe_key: `req:${id}`, site_id: siteId, member_id: null,
    title: `Client request · ${site.name}`, body: text.slice(0, 300), created_at: nowIso(), acknowledged_at: null, acknowledged_by: null });
  return id;
}

export function activePortalLink(s: S, token: unknown) {
  return t(s, 'patrol_portal_links').find((x) => x.token_plain === token && !x.revoked_at && (!x.expires_at || Date.parse(x.expires_at) > Date.now()));
}

export const clientProofRpcs: Record<string, (s: S, c: ClientCtx, a: Record<string, any>) => unknown> = {
  patrol_client_site_proof(s, c, a) {
    const site = t(s, 'patrol_sites').find((x) => x.id === a.p_site);
    if (!site || !(c.clientSites.includes(site.id) || c.staffOrgs.includes(site.org_id))) return null;
    return siteProof(s, site.id);
  },
  patrol_portal_request(s, _c, a) {
    const l = activePortalLink(s, a.p_token);
    if (!l) throw new BackendError('42501', 'link_inactive', 403);
    return addRequest(s, l.site_id, 'portal', l.id, null, a.p_name ?? null, a.p_body);
  },
  patrol_client_request(s, c, a) {
    if (!c.clientSites.includes(a.p_site)) throw new BackendError('42501', 'not_found', 403);
    const site = t(s, 'patrol_sites').find((x) => x.id === a.p_site)!;
    const member = c.memberIn(site.org_id);
    return addRequest(s, site.id, 'client', null, member, c.members.find((m) => m.id === member)?.display_name ?? null, a.p_body);
  },
  patrol_reply_client_request(s, c, a) {
    const q = t(s, 'patrol_client_requests').find((x) => x.id === a.p_id);
    if (!q || !c.staffOrgs.includes(q.org_id)) throw new BackendError('42501', 'not_found', 403);
    if (!['open', 'in_progress', 'done'].includes(a.p_status)) throw new BackendError('23514', 'bad_status', 400);
    const reply = String(a.p_reply ?? '').trim();
    Object.assign(q, { status: a.p_status, updated_at: nowIso() }, reply ? { reply: reply.slice(0, 2000), replied_by: c.memberIn(q.org_id), replied_at: nowIso() } : {});
    return null;
  },
};
