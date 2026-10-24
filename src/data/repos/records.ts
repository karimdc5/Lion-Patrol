import { signal } from '@preact/signals';
import { db, type CachedRecord, type Row } from '../db';

/** Bumped whenever cached records change; screens read it to re-query IndexedDB. */
export const dataVersion = signal(0);
export function bumpData() { dataVersion.value++; }

function orgOf(row: Row): string | null {
  return (row.org_id as string | undefined) ?? null;
}
function parentOf(table: string, row: Row): string | null {
  switch (table) {
    case 'patrol_dar_entries': return (row.dar_id as string) ?? null;
    case 'patrol_scans': return (row.tour_run_id as string) ?? (row.site_id as string) ?? null;
    case 'patrol_attachments': return (row.parent_id as string) ?? null;
    case 'patrol_checkpoints': return (row.site_id as string) ?? null;
    case 'patrol_subtypes': return (row.category_id as string) ?? null;
    case 'patrol_incident_events': return (row.incident_id as string) ?? null;
    default: return (row.site_id as string) ?? null;
  }
}

/** Merge server rows into the cache without clobbering local pending edits. */
export async function putServerRows(table: string, rows: Row[], opts: { replaceOrgs?: string[] } = {}) {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  const store = tx.store;
  const incoming = new Set(rows.map((r) => r.id));
  if (opts.replaceOrgs) {
    for (const org of opts.replaceOrgs) {
      const existing = await store.index('byTableOrg').getAll([table, org]);
      for (const rec of existing) if (!incoming.has(rec.id) && !rec._pending) await store.delete([table, rec.id]);
    }
  }
  for (const row of rows) {
    const prev = await store.get([table, row.id]);
    if (prev?._pending) continue; // local edit wins until its op is done
    const rec: CachedRecord = {
      table,
      id: row.id,
      orgId: orgOf(row),
      parentId: parentOf(table, row),
      updatedAt: (row.updated_at as string) ?? (row.created_at as string) ?? new Date().toISOString(),
      _pending: 0,
      _localRev: prev?._localRev ?? 0,
      data: row,
    };
    await store.put(rec);
  }
  await tx.done;
  bumpData();
}

export async function getRecord<T = Row>(table: string, id: string): Promise<(T & { _pending?: boolean }) | undefined> {
  const r = await (await db()).get('records', [table, id]);
  return r ? ({ ...(r.data as T), _pending: !!r._pending }) : undefined;
}

export async function listRecords<T = Row>(table: string, orgId?: string | null): Promise<Array<T & { _pending?: boolean }>> {
  const d = await db();
  const recs = orgId
    ? await d.getAllFromIndex('records', 'byTableOrg', [table, orgId])
    : await d.getAllFromIndex('records', 'byTable', table);
  return recs.map((r) => ({ ...(r.data as T), _pending: !!r._pending }));
}

export async function listByParent<T = Row>(table: string, parentId: string): Promise<Array<T & { _pending?: boolean }>> {
  const recs = await (await db()).getAllFromIndex('records', 'byTableParent', [table, parentId]);
  return recs.map((r) => ({ ...(r.data as T), _pending: !!r._pending }));
}

export async function clearTable(table: string) {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  for (const k of await tx.store.index('byTable').getAllKeys(table)) await tx.store.delete(k);
  await tx.done;
}
