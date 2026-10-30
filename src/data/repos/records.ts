import { signal } from '@preact/signals';
import { db, type CachedRecord, type Row } from '../db';
import type { SelectQuery } from '../backend/types';

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

/** A server query's scope: cached rows inside it that the server didn't return were deleted/moved. */
export interface ReconcileScope { match: (row: Row) => boolean; startedAt: number }
/** Rows touched locally this recently are kept even if missing (their insert may have raced the read). */
const RECENT_LOCAL_MS = 120_000;

/**
 * Scope for a windowed select (eq / in / gte / gt filters). When the result hit `limit`, the scope
 * shrinks to the returned key range so rows beyond the limit are never dropped.
 */
export function scopeOf(q: SelectQuery, rows: Row[], startedAt = Date.now()): ReconcileScope {
  const eq = Object.entries(q.eq ?? {}), inn = Object.entries(q.in ?? {}), gte = Object.entries(q.gte ?? {}), gt = Object.entries(q.gt ?? {});
  let bound: ((r: Row) => boolean) | null = null;
  if (q.limit && rows.length >= q.limit) {
    if (!q.order) return { match: () => false, startedAt };
    const [col, dir] = q.order;
    const keys = rows.map((r) => r[col] as string | number).filter((k) => k != null).sort();
    const edge = dir === 'desc' ? keys[0] : keys.at(-1);
    bound = edge == null ? () => false : (r) => { const v = r[col] as string | number; return v != null && (dir === 'desc' ? v >= edge : v <= edge); };
  }
  return {
    startedAt,
    match: (r) => eq.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) && inn.every(([k, v]) => v.includes(r[k] as string | number))
      && gte.every(([k, v]) => r[k] != null && (r[k] as string | number) >= v) && gt.every(([k, v]) => r[k] != null && (r[k] as string | number) > v)
      && (!bound || bound(r)),
  };
}

/**
 * Merge server rows into the cache without clobbering local pending edits.
 * `replaceOrgs`: the rows are the full set for those orgs. `scope`: the rows are the full set for
 * that query window. Either way, cached rows the server no longer returns are removed.
 */
export async function putServerRows(table: string, rows: Row[], opts: { replaceOrgs?: string[]; scope?: ReconcileScope } = {}) {
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
  if (opts.scope) {
    const { match, startedAt } = opts.scope;
    for (const rec of await store.index('byTable').getAll(table)) {
      if (incoming.has(rec.id) || rec._pending) continue;
      if (Date.parse(rec.updatedAt) > startedAt - RECENT_LOCAL_MS && rec._localRev > 0) continue;
      if (match(rec.data)) await store.delete([table, rec.id]);
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

/**
 * Drop cached rows of orgs none of this device's signed-in users belong to any more (member moved
 * to another company, removed, or org deleted). Pending local edits are kept.
 */
export async function pruneOrgs(keepOrgIds: string[]) {
  const keep = new Set(keepOrgIds);
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  let cursor = await tx.store.openCursor();
  let removed = 0;
  while (cursor) {
    const r = cursor.value;
    const org = r.table === 'patrol_orgs' ? r.id : r.orgId;
    if (org && !keep.has(org) && !r._pending) { await cursor.delete(); removed++; }
    cursor = await cursor.continue();
  }
  await tx.done;
  if (removed) bumpData();
  return removed;
}
