import { isNetworkError, type Backend } from '../backend/types';
import type { Bootstrap } from '../types';
import { putServerRows, pruneOrgs, scopeOf, withLocalId, overlayOwnEdits, type ReconcileScope } from '../repos/records';
import { db, kvSet, type Row } from '../db';
import { lastSyncAt } from './status';

const REFERENCE: Array<[keyof Bootstrap, string, boolean]> = [
  ['orgs', 'patrol_orgs', false],
  ['settings', 'patrol_org_settings', true],
  ['public_settings', 'patrol_public_settings', true],
  ['members', 'patrol_members', true],
  ['sites', 'patrol_sites', true],
  ['site_access', 'patrol_site_access', true],
  ['checkpoints', 'patrol_checkpoints', true],
  ['categories', 'patrol_categories', true],
  ['subtypes', 'patrol_subtypes', true],
  ['shifts', 'patrol_shifts', false],
  ['open_time_entries', 'patrol_time_entries', false],
  ['open_dars', 'patrol_dars', false],
  ['open_tour_runs', 'patrol_tour_runs', false],
  ['consents', 'patrol_consents', false],
  ['member_status', 'patrol_member_status', true],
];

/** Rows without an `id` column get a stable synthetic one. */
function withIds(table: string, rows: Row[] | Array<Record<string, unknown>>): Row[] {
  return (rows as Array<Record<string, unknown>>).map((r) => {
    if (typeof r.id === 'string') return r as Row;
    if (table === 'patrol_org_settings' || table === 'patrol_public_settings') return { ...r, id: String(r.org_id) } as Row;
    if (table === 'patrol_site_access') return { ...r, id: `${r.site_id}:${r.member_id}` } as Row;
    if (table === 'patrol_member_status') return { ...r, id: String(r.member_id) } as Row;
    return { ...r, id: JSON.stringify(r) } as Row;
  });
}

/** Windows of the non-reference bootstrap lists: cached rows inside them the server didn't return are stale. */
function windowScope(key: keyof Bootstrap, orgIds: string[], myMembers: Set<string>, startedAt: number): ReconcileScope | null {
  const inOrg = (r: Row) => orgIds.includes(String(r.org_id));
  const mine = (r: Row) => inOrg(r) && myMembers.has(String(r.member_id));
  const now = Date.now();
  switch (key) {
    case 'shifts': return { startedAt, match: (r) => inOrg(r) && Date.parse(String(r.ends_at)) > now - 864e5 && Date.parse(String(r.starts_at)) < now + 14 * 864e5 };
    case 'open_time_entries': return { startedAt, match: (r) => mine(r) && !r.clock_out_at };
    case 'open_dars': return { startedAt, match: (r) => mine(r) && r.status === 'open' };
    case 'open_tour_runs': return { startedAt, match: (r) => mine(r) && !r.completed_at && Date.parse(String(r.started_at)) > now - 864e5 };
    case 'consents': return { startedAt, match: mine };
    default: return null;
  }
}

export async function runBootstrap(backend: Backend, userId: string, email = ''): Promise<Bootstrap> {
  const startedAt = Date.now();
  const b = await backend.rpc<Bootstrap>('patrol_bootstrap');
  const orgIds = (b.memberships ?? []).map((m) => m.org_id);
  const myMembers = new Set((b.memberships ?? []).map((m) => m.id));
  // Orgs this device no longer has any signed-in member of: drop their cached rows.
  const others = (await (await db()).getAll('identity')).filter((i) => i.userId !== userId).flatMap((i) => i.memberships.map((m) => String(m.org_id)));
  await pruneOrgs([...orgIds, ...others]);
  for (const [key, table, replace] of REFERENCE) {
    const rows = withIds(table, (b[key] as unknown as Row[]) ?? []);
    const scope = windowScope(key, orgIds, myMembers, startedAt);
    await putServerRows(table, rows, replace ? { replaceOrgs: orgIds } : scope ? { scope } : {});
  }
  // Active BOLOs + their photos, site photos (plain RLS-scoped selects; not part of the bootstrap RPC).
  if (orgIds.length) {
    try {
      const bolos = await backend.select<Row>('patrol_bolos', { in: { org_id: orgIds }, eq: { status: 'active' }, limit: 200 });
      await putServerRows('patrol_bolos', bolos, { scope: scopeOf({ in: { org_id: orgIds }, eq: { status: 'active' }, limit: 200 }, bolos, startedAt) });
      if (bolos.length) await putServerRows('patrol_attachments', await backend.select<Row>('patrol_attachments', { in: { parent_id: bolos.map((b) => b.id) } }));
    } catch { /* offline or not migrated yet: keep cache */ }
    // Post-order codes + this user's acknowledgments (item 24); needed offline at clock-in.
    for (const t of ['patrol_site_codes', 'patrol_post_order_acks']) {
      try {
        const q = { in: { org_id: orgIds }, limit: 1000 };
        const rows = (await backend.select<Record<string, unknown>>(t, q)).map((r) => withLocalId(t, r));
        await putServerRows(t, rows, { scope: scopeOf(q, rows, startedAt) });
        await kvSet(`missing:${t}`, false);
      } catch (e) {
        // A server without the table (migration not applied yet): the feature stays off instead of nagging.
        if (!isNetworkError(e)) await kvSet(`missing:${t}`, true);
      }
    }
    try {
      const q = { in: { org_id: orgIds }, eq: { parent_type: 'site' }, limit: 500 };
      const photos = await backend.select<Row>('patrol_attachments', q);
      await putServerRows('patrol_attachments', photos, { scope: scopeOf(q, photos, startedAt) });
    } catch { /* offline: keep cache */ }
  }
  await (await db()).put('identity', {
    userId,
    email,
    isAppAdmin: !!b.is_app_admin,
    memberships: await overlayOwnEdits(b.memberships as unknown as Row[]),
    updatedAt: Date.now(),
  });
  await kvSet('bootstrapAt', Date.now());
  lastSyncAt.value = Date.now();
  return b;
}

