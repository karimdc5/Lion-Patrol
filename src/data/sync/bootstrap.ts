import type { Backend } from '../backend/types';
import type { Bootstrap } from '../types';
import { putServerRows } from '../repos/records';
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

export async function runBootstrap(backend: Backend, userId: string, email = ''): Promise<Bootstrap> {
  const b = await backend.rpc<Bootstrap>('patrol_bootstrap');
  const orgIds = (b.memberships ?? []).map((m) => m.org_id);
  for (const [key, table, replace] of REFERENCE) {
    const rows = withIds(table, (b[key] as unknown as Row[]) ?? []);
    await putServerRows(table, rows, replace ? { replaceOrgs: orgIds } : {});
  }
  // Active BOLOs + their photos (plain RLS-scoped selects; not part of the bootstrap RPC).
  if (orgIds.length) {
    try {
      const bolos = await backend.select<Row>('patrol_bolos', { in: { org_id: orgIds }, eq: { status: 'active' }, limit: 200 });
      await putServerRows('patrol_bolos', bolos, { replaceOrgs: orgIds });
      if (bolos.length) await putServerRows('patrol_attachments', await backend.select<Row>('patrol_attachments', { in: { parent_id: bolos.map((b) => b.id) } }));
    } catch { /* offline or not migrated yet: keep cache */ }
  }
  await (await db()).put('identity', {
    userId,
    email,
    isAppAdmin: !!b.is_app_admin,
    memberships: b.memberships as unknown as Row[],
    updatedAt: Date.now(),
  });
  await kvSet('bootstrapAt', Date.now());
  lastSyncAt.value = Date.now();
  return b;
}
