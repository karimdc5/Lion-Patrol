import { db, type CachedRecord, type BlobRecord, type Row } from '../db';
import { uuidv7 } from '../../lib/uuid';
import type { OutboxOp, OpKind } from './types';

export interface EnqueueInput {
  userId: string;
  orgId: string;
  kind: OpKind;
  table?: string;
  rpc?: string;
  payload: unknown;
  match?: Record<string, string>;
  entityKey: string;
  dependsOn?: string[];
  label: string;
  priority?: number;
  id?: string;
  noCoalesce?: boolean;
}

export interface LocalWrite {
  table: string;
  row: Row;
  orgId: string | null;
  parentId?: string | null;
}

const DONE_TTL_MS = 24 * 3600 * 1000;

/**
 * Atomically write local records (+ optional blobs) and enqueue the op in ONE transaction.
 * Coalesces into a still-pending upsert for the same entity. Returns the op id.
 */
export async function enqueue(input: EnqueueInput, writes: LocalWrite[] = [], blobs: BlobRecord[] = []): Promise<string> {
  const d = await db();
  const tx = d.transaction(['outbox', 'records', 'kv', 'blobs'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  const records = tx.objectStore('records');
  let opId = input.id ?? uuidv7();

  for (const w of writes) {
    const prev = await records.get([w.table, w.row.id]);
    const rec: CachedRecord = {
      table: w.table,
      id: w.row.id,
      orgId: w.orgId,
      parentId: w.parentId ?? prev?.parentId ?? null,
      updatedAt: new Date().toISOString(),
      _pending: 1,
      _localRev: (prev?._localRev ?? 0) + 1,
      data: { ...(prev?.data ?? {}), ...w.row },
    };
    await records.put(rec);
  }
  for (const b of blobs) await tx.objectStore('blobs').put(b);

  let coalesced = false;
  if (input.kind === 'upsert' && !input.noCoalesce) {
    const same = await outbox.index('byEntity').getAll(input.entityKey);
    const target = same
      .filter((o) => o.kind === 'upsert' && o.status === 'pending' && o.userId === input.userId)
      .sort((a, b) => b.seq - a.seq)[0];
    if (target) {
      const merged = mergePayload(target.payload, input.payload);
      await outbox.put({
        ...target,
        payload: merged,
        label: input.label,
        dependsOn: Array.from(new Set([...target.dependsOn, ...(input.dependsOn ?? [])])),
        priority: Math.min(target.priority, input.priority ?? 5),
        nextAttemptAt: 0,
        attempts: 0,
      });
      opId = target.id;
      coalesced = true;
    }
  }
  if (!coalesced) {
    const seqRec = await tx.objectStore('kv').get('outboxSeq');
    const seq = ((seqRec?.value as number | undefined) ?? 0) + 1;
    await tx.objectStore('kv').put({ key: 'outboxSeq', value: seq });
    const op: OutboxOp = {
      id: opId,
      seq,
      priority: input.priority ?? 5,
      userId: input.userId,
      orgId: input.orgId,
      kind: input.kind,
      table: input.table,
      rpc: input.rpc,
      payload: input.payload,
      match: input.match,
      entityKey: input.entityKey,
      dependsOn: input.dependsOn ?? [],
      label: input.label,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: Date.now(),
    };
    await outbox.put(op);
  }
  await tx.done;
  return opId;
}

function mergePayload(a: unknown, b: unknown): unknown {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    return { ...(a as object), ...(b as object) };
  }
  return b;
}

export async function allOps(): Promise<OutboxOp[]> {
  return (await db()).getAll('outbox');
}

export async function opsForUser(userId: string): Promise<OutboxOp[]> {
  const ops = await allOps();
  return ops.filter((o) => o.userId === userId).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
}

export async function counts(userId: string | null) {
  const ops = userId ? await opsForUser(userId) : [];
  let pending = 0, inflight = 0, dead = 0;
  for (const o of ops) {
    if (o.status === 'pending') pending++;
    else if (o.status === 'inflight') inflight++;
    else if (o.status === 'dead') dead++;
  }
  return { pending, inflight, dead };
}

export async function putOp(op: OutboxOp) {
  await (await db()).put('outbox', op);
}

export async function getOp(id: string) {
  return (await db()).get('outbox', id);
}

/** After a crash/kill, inflight ops are safe to replay (idempotent). */
export async function resetInflight(): Promise<number> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const inflight = await tx.store.index('byStatus').getAll('inflight');
  for (const o of inflight) await tx.store.put({ ...o, status: 'pending', nextAttemptAt: 0 });
  await tx.done;
  return inflight.length;
}

export async function retryOp(id: string) {
  const op = await getOp(id);
  if (op && (op.status === 'dead' || op.status === 'pending')) {
    await putOp({ ...op, status: 'pending', attempts: 0, nextAttemptAt: 0 });
  }
}

export async function retryAll(userId: string) {
  for (const o of await opsForUser(userId)) {
    if (o.status === 'dead' || o.status === 'pending') await putOp({ ...o, status: 'pending', attempts: 0, nextAttemptAt: 0 });
  }
}

export async function discardOp(id: string) {
  await (await db()).delete('outbox', id);
}

export async function pruneDone(now = Date.now()) {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const done = await tx.store.index('byStatus').getAll('done');
  for (const o of done) if ((o.doneAt ?? 0) < now - DONE_TTL_MS) await tx.store.delete(o.id);
  await tx.done;
}

/** Clear the pending flag on a cached record once no live ops reference its entity. */
export async function settleRecord(entityKey: string) {
  const [table, id] = splitEntity(entityKey);
  if (!table || !id) return;
  const d = await db();
  const tx = d.transaction(['outbox', 'records'], 'readwrite');
  const live = (await tx.objectStore('outbox').index('byEntity').getAll(entityKey)).some(
    (o) => o.status === 'pending' || o.status === 'inflight' || o.status === 'dead',
  );
  if (!live) {
    const rec = await tx.objectStore('records').get([table, id]);
    if (rec && rec._pending) await tx.objectStore('records').put({ ...rec, _pending: 0 });
  }
  await tx.done;
}

export function splitEntity(entityKey: string): [string, string] {
  const i = entityKey.indexOf(':');
  return [entityKey.slice(0, i), entityKey.slice(i + 1)];
}
