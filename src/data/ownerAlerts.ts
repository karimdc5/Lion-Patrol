import { getBackend, currentOrgId, identity, isAdmin } from '../auth/session';
import { enqueue } from './outbox/queue';
import { kick } from './sync/engine';
import { putServerRows, listRecords, scopeOf, bumpData } from './repos/records';
import { db, type Row } from './db';
import { uuidv7 } from '../lib/uuid';
import { isNetworkError } from './backend/types';

/**
 * Item 18: owner-only alerts (missed checkpoints, no-shows, geofence blocks). Rows live in
 * patrol_owner_alerts, readable by owners/admins only (RLS). Any worker device of the org runs the
 * detector; it only learns a count, and a generic "N new owner alerts" email goes to the owners.
 */
export interface OwnerAlert extends Row { kind: 'missed_checkpoint' | 'overdue_patrol' | 'no_show' | 'geofence' | 'guard_card' | 'long_shift'; title: string; body: string; site_id: string | null; member_id: string | null; created_at: string; acknowledged_at: string | null; lat?: number | null; lng?: number | null }

let lastCheck = 0;
export async function checkOwnerAlerts(minGapMs = 60_000): Promise<number> {
  const org = currentOrgId.value, userId = identity.value?.userId;
  if (!org || !userId || Date.now() - lastCheck < minGapMs) return 0;
  lastCheck = Date.now();
  try {
    const r = await getBackend().rpc<{ created: number } | null>('patrol_check_owner_alerts', { p_org: org });
    // Claim un-emailed alerts (incl. ones the 5-minute server cron created) so each is emailed once.
    const n = await getBackend().rpc<number>('patrol_claim_owner_alert_emails', { p_org: org }).catch(() => r?.created ?? 0);
    if (n > 0) {
      await enqueue({ userId, orgId: org, kind: 'email', payload: { event: 'owner_alert', id: uuidv7(), orgId: org, count: n }, entityKey: `email:owner_alert:${uuidv7()}`, label: 'Notify owners (email)' });
      void kick();
    }
    return n;
  } catch { return 0; } // offline or migration not applied yet
}

const Q = (org: string) => ({ eq: { org_id: org }, order: ['created_at', 'desc'] as [string, 'desc'], limit: 100 });
export async function fetchOwnerAlerts() {
  const org = currentOrgId.value;
  if (!org || !isAdmin.value) return;
  try {
    const startedAt = Date.now();
    const rows = await getBackend().select<Row>('patrol_owner_alerts', Q(org));
    await putServerRows('patrol_owner_alerts', rows, { scope: scopeOf(Q(org), rows, startedAt) });
  } catch { /* offline or not migrated */ }
}
export async function listOwnerAlerts(org: string | null): Promise<OwnerAlert[]> {
  if (!isAdmin.value) return [];
  return (await listRecords<OwnerAlert>('patrol_owner_alerts', org)).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function ackOwnerAlert(a: OwnerAlert) {
  const at = new Date().toISOString();
  const d = await db();
  const rec = await d.get('records', ['patrol_owner_alerts', a.id]);
  if (rec) await d.put('records', { ...rec, data: { ...rec.data, acknowledged_at: at } });
  bumpData();
  try { await getBackend().update('patrol_owner_alerts', { acknowledged_at: at }, { id: a.id }); }
  catch (e) { if (!isNetworkError(e)) throw e; }
}

/**
 * B9: an alert whose condition has cleared no longer shows on Live (and is acknowledged so it stays
 * cleared on every device). Pure, so the rule is unit-tested:
 * - no_show: the guard clocked in for that shift (or after the alert was raised);
 * - long_shift: that time entry is now clocked out or voided.
 * Missed checkpoints, geofence blocks and guard cards are facts about the past — they stay until dismissed.
 */
export function alertCleared(a: Pick<OwnerAlert, 'kind' | 'member_id' | 'created_at'> & { time_entry_id?: unknown }, times: Row[]): boolean {
  if (a.kind === 'no_show') {
    const since = Date.parse(a.created_at) - 3 * 3600e3;
    return times.some((t) => t.member_id === a.member_id && !t.voided_at && Date.parse(String(t.clock_in_at)) >= since);
  }
  if (a.kind === 'long_shift') {
    const te = times.find((t) => t.id === a.time_entry_id);
    return !!te && (!!te.clock_out_at || !!te.voided_at);
  }
  return false;
}
