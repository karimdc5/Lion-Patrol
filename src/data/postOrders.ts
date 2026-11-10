import { enqueue } from './outbox/queue';
import { kick } from './sync/engine';
import { listRecords, getRecord, bumpData } from './repos/records';
import { kvGet, type Row } from './db';
import { identity, currentOrgId, memberId } from '../auth/session';
import { onShift } from './guard';

/** Item 24: gate/alarm codes (guards + staff only, never clients) and first-shift acknowledgment. */
export interface SiteCodes extends Row { site_id: string; org_id: string; codes: string; guard_notes: string }
export interface PostOrderAck extends Row { member_id: string; site_id: string; acked_at: string }

export const siteCodes = (siteId: string) => getRecord<SiteCodes>('patrol_site_codes', siteId);
export async function hasAcked(siteId: string, mid = memberId.value): Promise<boolean> {
  if (!mid || (await kvGet<boolean>('missing:patrol_post_order_acks'))) return true;
  return !!(await getRecord<PostOrderAck>('patrol_post_order_acks', `${mid}:${siteId}`));
}
/** True when the guard is on shift at a site whose post orders they've never acknowledged. */
export async function ackDue(): Promise<string | null> {
  const te = onShift.value;
  if (!te) return null;
  return (await hasAcked(te.site_id)) ? null : te.site_id;
}
/** Sites acknowledged in this session (so a stale "due" read can't bounce the guard back). */
export const ackedNow = new Set<string>();
export async function acknowledgePostOrders(siteId: string, ordersUpdatedAt: string | null) {
  ackedNow.add(siteId);
  const userId = identity.value?.userId, orgId = currentOrgId.value, mid = memberId.value;
  if (!userId || !orgId || !mid) throw new Error('Not signed in');
  const payload = { member_id: mid, site_id: siteId, org_id: orgId, acked_at: new Date().toISOString(), orders_updated_at: ordersUpdatedAt, time_entry_id: onShift.value?.site_id === siteId ? onShift.value.id : null };
  await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_post_order_acks', payload, entityKey: `patrol_post_order_acks:${mid}:${siteId}`, label: 'Post orders acknowledged' },
    [{ table: 'patrol_post_order_acks', row: { ...payload, id: `${mid}:${siteId}` } as Row, orgId }]);
  bumpData(); void kick();
}
export async function saveSiteCodes(siteId: string, codes: string, guardNotes: string) {
  const userId = identity.value?.userId, orgId = currentOrgId.value;
  if (!userId || !orgId) throw new Error('Not signed in');
  const payload = { site_id: siteId, org_id: orgId, codes, guard_notes: guardNotes };
  await enqueue({ userId, orgId, kind: 'upsert', table: 'patrol_site_codes', payload, entityKey: `patrol_site_codes:${siteId}`, label: 'Site codes' },
    [{ table: 'patrol_site_codes', row: { ...payload, id: siteId } as Row, orgId }]);
  bumpData(); void kick();
}
export const listAcks = async (org: string | null) => listRecords<PostOrderAck>('patrol_post_order_acks', org);
