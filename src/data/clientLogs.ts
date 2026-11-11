import { getBackend } from '../auth/session';
import { BackendError, isNetworkError } from './backend/types';
import { mergeNightReport, type MergedReport, type ReportItems } from '../../supabase/functions/_shared/client-logs';

/**
 * Pass 9 chunk 2: Client logs (one combined report per site per night) + client email settings/outbox.
 * Online-only (server state). Emails are only ever sent by the patrol-client-logs edge function; this
 * module queues them and reports the honest state — it never marks anything "sent".
 */
export interface ClientReport {
  id: string; org_id: string; site_id: string; night: string;
  status: 'waiting' | 'ready' | 'queued' | 'sending' | 'sent' | 'not_configured' | 'failed' | 'dry_run' | 'no_recipients';
  ready_reason: 'last_clock_out' | 'fallback_8am' | null; note: string | null; ready_at: string | null;
  approved_at: string | null; sent_at: string | null; send_count: number; last_email_id: string | null; last_error: string | null; updated_at?: string;
}
export interface ClientEmail { id: string; org_id: string; site_id: string | null; kind: string; ref_id: string | null; status: string; error: string | null; subject: string; sent_to: string[]; created_at: string; sent_at: string | null }
export interface SiteClientEmail {
  site_id: string; org_id: string; recipients: string[]; auto_send_logs: boolean;
  notify_incident: boolean; notify_missed_patrol: boolean; notify_dar: boolean; notify_invoice: boolean;
}
export const FUNCTION_NAME = 'patrol-client-logs';

/** The pass 9 chunk 2 migration isn't applied yet (missing table / function). */
export function isNotInstalled(e: unknown): boolean {
  return e instanceof BackendError && (['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code) || (e.http === 404 && !/function_not_deployed/.test(e.message)));
}

export const defaultSiteClientEmail = (site_id: string, org_id: string): SiteClientEmail =>
  ({ site_id, org_id, recipients: [], auto_send_logs: false, notify_incident: false, notify_missed_patrol: false, notify_dar: false, notify_invoice: false });

export async function listClientReports(org: string): Promise<ClientReport[]> {
  return getBackend().select<ClientReport>('patrol_client_reports', { eq: { org_id: org }, order: ['night', 'desc'], limit: 120 });
}
export async function listClientEmails(org: string): Promise<ClientEmail[]> {
  return getBackend().select<ClientEmail>('patrol_client_emails', { eq: { org_id: org }, order: ['created_at', 'desc'], limit: 100 });
}
export async function listSiteClientEmail(org: string): Promise<SiteClientEmail[]> {
  return getBackend().select<SiteClientEmail>('patrol_site_client_email', { eq: { org_id: org } });
}
export async function saveSiteClientEmail(row: SiteClientEmail) {
  const recipients = parseRecipients(row.recipients.join('\n'));
  if (recipients.bad.length) throw new Error(`Not an email address: ${recipients.bad.join(', ')}`);
  if (recipients.ok.length > 10) throw new Error('At most 10 client email addresses per site.');
  const { site_id, org_id, auto_send_logs, notify_incident, notify_missed_patrol, notify_dar, notify_invoice } = row;
  await getBackend().upsert('patrol_site_client_email', [{ site_id, org_id, recipients: recipients.ok, auto_send_logs, notify_incident, notify_missed_patrol, notify_dar, notify_invoice }]);
}

export function parseRecipients(text: string): { ok: string[]; bad: string[] } {
  const parts = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok = [...new Set(parts.filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
  return { ok, bad: parts.filter((x) => !ok.includes(x)) };
}

export async function previewReport(id: string): Promise<MergedReport | null> {
  const items = await getBackend().rpc<ReportItems | null>('patrol_client_report_items', { p_id: id });
  return items ? mergeNightReport(items) : null;
}

export type KickResult = { state: 'processed'; sent: number; notConfigured: boolean } | { state: 'not_deployed' } | { state: 'queued' };

/**
 * Ask the edge function to process the outbox now (the 5-minute cron does the same). If the function is
 * not deployed, the queued rows are marked "not configured" so the owner sees the truth instead of
 * an email that will never leave. Other failures leave rows queued for the cron.
 */
export async function kickEmails(ids: Array<string | null | undefined>): Promise<KickResult> {
  const b = getBackend();
  const queued = ids.filter((x): x is string => !!x);
  try {
    if (!b.invoke) throw new BackendError('404', 'function_not_deployed', 404);
    const r = await b.invoke<{ configured?: boolean; sent?: number }>(FUNCTION_NAME, { action: 'process' });
    return { state: 'processed', sent: Number(r?.sent ?? 0), notConfigured: r?.configured === false };
  } catch (e) {
    if (e instanceof BackendError && e.http === 404) {
      await Promise.all(queued.map((id) => b.rpc('patrol_client_email_unavailable', { p_id: id, p_reason: 'Email function not deployed (patrol-client-logs)' }).catch(() => undefined)));
      return { state: 'not_deployed' };
    }
    if (isNetworkError(e)) return { state: 'queued' };
    return { state: 'queued' };
  }
}

export async function sendReport(id: string): Promise<KickResult> {
  const email = await getBackend().rpc<string | null>('patrol_client_report_send', { p_id: id });
  return kickEmails([email]);
}

export async function sendInvoiceEmail(id: string): Promise<KickResult> {
  const email = await getBackend().rpc<string | null>('patrol_invoice_send', { p_id: id });
  return kickEmails([email]);
}

export const INVOICE_SEND_ERRORS: Record<string, string> = {
  invoice_email_off: "Turn on 'Invoice sent' under Sites → Client email for this site first.",
  no_client_email: 'Add a client email (Sites → Client email, or the accounts-payable email on the site’s billing) first.',
  invoice_zero: 'A $0 invoice can’t be sent.',
  invoice_void: 'This invoice is void.',
};

/** Honest email state for banners: derived from what the server outbox actually recorded. */
export function emailSetupState(emails: ClientEmail[]): 'not_configured' | 'dry_run' | 'working' | 'failing' | 'unknown' {
  const done = emails.filter((e) => !['queued', 'sending', 'cancelled'].includes(e.status));
  const last = done[0];
  if (!last) return 'unknown';
  if (last.status === 'not_configured') return 'not_configured';
  if (last.status === 'dry_run') return 'dry_run';
  if (last.status === 'failed') return 'failing';
  return done.some((e) => e.status === 'sent') ? 'working' : 'unknown';
}

export const REPORT_STATUS: Record<ClientReport['status'], { label: string; tone: string }> = {
  waiting: { label: 'Waiting on guards', tone: 'pill-muted' },
  ready: { label: 'Ready for your OK', tone: 'pill-warning' },
  queued: { label: 'Queued to send', tone: 'pill-info' },
  sending: { label: 'Sending…', tone: 'pill-info' },
  sent: { label: 'Sent', tone: 'pill-success' },
  not_configured: { label: 'Not sent — email not configured', tone: 'pill-danger' },
  failed: { label: 'Send failed', tone: 'pill-danger' },
  dry_run: { label: 'Dry run — not emailed', tone: 'pill-muted' },
  no_recipients: { label: 'Not sent — no client email', tone: 'pill-danger' },
};
