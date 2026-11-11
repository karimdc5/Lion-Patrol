// Lion Patrol — patrol-client-logs edge function (pass 9 chunk 2).
// Processes the server-side email outbox (public.patrol_client_emails): nightly client reports
// ("Client logs"), incident / DAR / missed-patrol / invoice client emails and the owner "ready for
// your OK" ping. Sends from contact@lionofseattle.com through the provider named in the secrets.
//
// Callers: the pg_cron job (header x-patrol-cron-secret = PATROL_CRON_SECRET) or a signed-in
// owner/admin pressing Send now (Authorization: Bearer <user JWT>). Body: { "action": "process" }.
//
// Honesty rules: if CLIENT_MAIL_PROVIDER / CLIENT_MAIL_API_KEY are missing every claimed row is marked
// 'not_configured' and the response says { configured: false }. Unless CLIENT_MAIL_MODE=live, rows are
// marked 'dry_run' and nothing is emailed. Only a provider 2xx marks a row 'sent'.
// Secrets (names only; see docs/PASS9-backend-setup.md): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (built in),
// PATROL_CRON_SECRET, CLIENT_MAIL_PROVIDER, CLIENT_MAIL_API_KEY, CLIENT_MAIL_MODE, CLIENT_MAIL_FROM_NAME,
// CLIENT_MAIL_TEST_TO.
import { mailConfig, buildMessage, providerRequest, mergeNightReport, type OutboxRow, type ReportItems } from '../_shared/client-logs.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(h: (req: Request) => Response | Promise<Response>): void };

const env = Deno.env.toObject();
const URL_ = env.SUPABASE_URL ?? '';
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-patrol-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

/** Signed-in owner/admin of any org (RLS on patrol_members lets a user read their own rows). */
async function isOwnerOrAdmin(auth: string): Promise<boolean> {
  const u = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: auth } });
  if (!u.ok) return false;
  const user = await u.json() as { id?: string };
  if (!user.id) return false;
  const m = await fetch(`${URL_}/rest/v1/patrol_members?select=id&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&role=in.(owner,admin)&limit=1`,
    { headers: { apikey: SERVICE, Authorization: auth } });
  return m.ok && ((await m.json()) as unknown[]).length > 0;
}

const result = (id: string, status: string, error: string | null = null, providerId: string | null = null, sentTo: string[] = []) =>
  rpc('patrol_client_email_result', { p_id: id, p_status: status, p_error: error, p_provider_id: providerId, p_sent_to: sentTo });

async function processOutbox() {
  const cfg = mailConfig(env);
  const rows = await rpc<OutboxRow[]>('patrol_client_email_claim', { p_limit: 25 }) ?? [];
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  for (const row of rows) {
    try {
      if (!cfg.configured) { await result(row.id, 'not_configured', `Email sending not configured (missing ${cfg.missing.join(', ')})`); bump('not_configured'); continue; }
      const items = row.kind === 'client_log' && row.ref_id ? await rpc<ReportItems | null>('patrol_client_report_items', { p_id: row.ref_id }) : null;
      const msg = buildMessage(row, items ? mergeNightReport(items) : null, cfg);
      if (!msg) { await result(row.id, 'no_recipients', 'No client email address on file for this site'); bump('no_recipients'); continue; }
      if (cfg.mode !== 'live') { await result(row.id, 'dry_run', 'CLIENT_MAIL_MODE is not live — not emailed', null, []); bump('dry_run'); continue; }
      const req = providerRequest(cfg, msg);
      const res = await fetch(req.url, req.init);
      const body = await res.json().catch(() => ({})) as { id?: string; MessageID?: string; message?: string; Message?: string };
      if (res.ok) { await result(row.id, 'sent', null, body.id ?? body.MessageID ?? null, msg.to); bump('sent'); }
      else { await result(row.id, 'failed', `${cfg.provider} ${res.status}: ${body.message ?? body.Message ?? ''}`.slice(0, 400)); bump('failed'); }
    } catch (e) {
      await result(row.id, 'failed', String((e as Error).message ?? e).slice(0, 400)).catch(() => undefined);
      bump('failed');
    }
  }
  return { configured: cfg.configured, mode: cfg.mode, missing: cfg.missing, claimed: rows.length, sent: counts.sent ?? 0, counts };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!URL_ || !SERVICE) return json({ error: 'function_env_missing' }, 500);
  const cron = env.PATROL_CRON_SECRET && req.headers.get('x-patrol-cron-secret') === env.PATROL_CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!cron && !(auth.startsWith('Bearer ') && await isOwnerOrAdmin(auth))) return json({ error: 'not_allowed' }, 403);
  const body = await req.json().catch(() => ({})) as { action?: string };
  if ((body.action ?? 'process') !== 'process') return json({ error: 'unknown_action' }, 400);
  try {
    return json(await processOutbox());
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
