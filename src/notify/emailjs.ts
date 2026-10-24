import { EMAILJS, CLIENT_NOTIFICATIONS_ENABLED, EMAIL_TESTING_OWNERS_ONLY, PUBLIC_URL } from '../config';
import { BackendError, type Backend } from '../data/backend/types';

export interface NotifyTargets { enabled: boolean; min_severity: string; owners_only: boolean; recipients: string[] }
export const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Hard guard: every recipient must be in the owner-approved list returned by the server. */
export function assertOwnerRecipients(recipients: string[], allowed: string[]) {
  const ok = new Set(allowed.map((e) => e.toLowerCase()));
  const bad = recipients.filter((r) => !ok.has(r.toLowerCase()));
  if (bad.length) throw new Error(`Refusing to email non-owner addresses: ${bad.join(', ')}`);
  if (!recipients.length) throw new Error('No owner recipients configured');
}

export interface EmailEvent { event: 'incident' | 'sos'; id: string; orgId: string }

/** Build the EmailJS template params for an event. Pure; unit tested. */
export function buildEmail(ev: EmailEvent, row: Record<string, unknown>, siteName: string, recipients: string[]) {
  if (ev.event === 'sos') {
    const where = row.lat != null ? `https://maps.apple.com/?q=${row.lat},${row.lng}` : 'Location unavailable';
    return {
      to_email: recipients.join(','),
      subject: `SOS — ${row.member_name || 'Guard'} at ${siteName}`,
      message: `${row.member_name || 'A guard'} pressed SOS at ${siteName} at ${new Date(String(row.triggered_at)).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}.\nLocation: ${where}\nOpen the dashboard: ${PUBLIC_URL}a`,
      site_name: siteName, guard_name: String(row.member_name ?? ''), link: `${PUBLIC_URL}a`, map_url: where,
    };
  }
  const ref = String(row.report_no ?? 'New report');
  return {
    to_email: recipients.join(','),
    subject: `[Lion Patrol] Incident ${ref} — ${row.category_name ?? 'Incident'} at ${siteName}`,
    message: `${row.title || row.category_name || 'Incident'} (${String(row.severity ?? 'low')} severity)\nReported by ${row.author_name ?? 'guard'} at ${siteName}, ${new Date(String(row.occurred_at)).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}.\n\n${String(row.description ?? '').slice(0, 600)}\n\nReview: ${PUBLIC_URL}a/incidents/${row.id}`,
    site_name: siteName, guard_name: String(row.author_name ?? ''), report_no: ref, severity: String(row.severity ?? ''), category: String(row.category_name ?? ''), link: `${PUBLIC_URL}a/incidents/${row.id}`,
  };
}

/** Outbox executor for `email` ops. Never emails clients; skips silently in demo mode. */
export async function deliverEmail(ev: EmailEvent, backend: Backend, opts: { demo: boolean }) {
  if (CLIENT_NOTIFICATIONS_ENABLED as boolean) throw new Error('Client notifications are disabled in this build');
  const targets = await backend.rpc<NotifyTargets | null>('patrol_notify_targets', { p_org: ev.orgId });
  if (!targets || !targets.enabled || !targets.recipients.length) return 'skipped';
  const table = ev.event === 'sos' ? 'patrol_alerts' : 'patrol_incidents';
  const row = (await backend.select<Record<string, unknown>>(table, { eq: { id: ev.id } }))[0];
  if (!row) throw new BackendError('23503', 'notification target not synced yet', 409);
  if (row.notified_at) return 'already';
  if (ev.event === 'incident' && (SEVERITY_RANK[String(row.severity)] ?? 0) < (SEVERITY_RANK[targets.min_severity] ?? 1)) return 'below-threshold';
  if (EMAIL_TESTING_OWNERS_ONLY && !targets.owners_only) throw new Error('Testing guard: owners-only mode must be on');
  assertOwnerRecipients(targets.recipients, targets.recipients);
  const site = row.site_id ? (await backend.select<Record<string, unknown>>('patrol_sites', { eq: { id: String(row.site_id) } }))[0] : undefined;
  const params = buildEmail(ev, row, String(site?.name ?? 'site'), targets.recipients);
  if (opts.demo) return 'demo';
  const res = await fetch(EMAILJS.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: EMAILJS.serviceId, template_id: EMAILJS.templateId, user_id: EMAILJS.publicKey, template_params: params }),
  });
  if (!res.ok) throw new BackendError(String(res.status), `EmailJS ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`, res.status >= 500 ? res.status : 400);
  await backend.rpc('patrol_mark_notified', { p_table: table, p_id: ev.id });
  return 'sent';
}
