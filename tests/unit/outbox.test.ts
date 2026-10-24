import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, fakeBackend } from './helpers';
import { enqueue, opsForUser, resetInflight, putOp, counts } from '../../src/data/outbox/queue';
import { OutboxWorker, pickNext } from '../../src/data/outbox/worker';
import { BackendError } from '../../src/data/backend/types';
import { db } from '../../src/data/db';
import { getRecord } from '../../src/data/repos/records';

const U = 'user-1';
const ORG = 'org-1';

const workers: OutboxWorker[] = [];
function worker(backend: ReturnType<typeof fakeBackend>['backend'], user = U) {
  const w = new OutboxWorker({ backend: () => backend, userId: () => user, fastBackoff: () => true });
  workers.push(w);
  return w;
}
afterEach(async () => { for (const w of workers.splice(0)) { await w.idle(); w.dispose(); } });

describe('outbox queue', () => {
  beforeEach(freshDb);

  it('writes the local record and the op atomically, marking the record pending', async () => {
    const id = await enqueue(
      { userId: U, orgId: ORG, kind: 'insert', table: 'patrol_scans', payload: { id: 's1' }, entityKey: 'patrol_scans:s1', label: 'Scan' },
      [{ table: 'patrol_scans', row: { id: 's1', org_id: ORG }, orgId: ORG }],
    );
    const ops = await opsForUser(U);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe(id);
    const rec = await getRecord('patrol_scans', 's1');
    expect(rec?._pending).toBe(true);
  });

  it('coalesces repeated upserts of a pending draft into one op with merged payload', async () => {
    for (let i = 1; i <= 5; i++) {
      await enqueue({ userId: U, orgId: ORG, kind: 'upsert', table: 'patrol_incidents', payload: { id: 'i1', client_rev: i, title: `t${i}` }, entityKey: 'patrol_incidents:i1', label: 'Draft' });
    }
    const ops = await opsForUser(U);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.payload).toMatchObject({ id: 'i1', client_rev: 5, title: 't5' });
  });

  it('does not coalesce into an inflight op', async () => {
    const first = await enqueue({ userId: U, orgId: ORG, kind: 'upsert', table: 'patrol_incidents', payload: { id: 'i1', client_rev: 1 }, entityKey: 'patrol_incidents:i1', label: 'Draft' });
    const op = (await opsForUser(U))[0]!;
    await putOp({ ...op, status: 'inflight' });
    const second = await enqueue({ userId: U, orgId: ORG, kind: 'upsert', table: 'patrol_incidents', payload: { id: 'i1', client_rev: 2 }, entityKey: 'patrol_incidents:i1', label: 'Draft' });
    expect(second).not.toBe(first);
    expect(await opsForUser(U)).toHaveLength(2);
  });

  it('resets inflight ops to pending after a crash', async () => {
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 't', payload: { id: 'x' }, entityKey: 't:x', label: 'x' });
    const op = (await opsForUser(U))[0]!;
    await putOp({ ...op, status: 'inflight' });
    expect(await resetInflight()).toBe(1);
    expect((await opsForUser(U))[0]!.status).toBe('pending');
  });
});

describe('outbox worker', () => {
  beforeEach(freshDb);

  it('flushes in order and clears the pending flag', async () => {
    const fb = fakeBackend();
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_dars', payload: { id: 'd1' }, entityKey: 'patrol_dars:d1', label: 'DAR' }, [{ table: 'patrol_dars', row: { id: 'd1' }, orgId: ORG }]);
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_dar_entries', payload: { id: 'e1' }, entityKey: 'patrol_dar_entries:e1', label: 'Entry' });
    const w = worker(fb.backend);
    await w.kick();
    expect(fb.calls.map((c) => c.table)).toEqual(['patrol_dars', 'patrol_dar_entries']);
    expect((await getRecord('patrol_dars', 'd1'))?._pending).toBe(false);
    expect((await counts(U)).pending).toBe(0);
  });

  it('honours dependsOn: a dependent waits while its parent is backing off; unrelated ops continue', async () => {
    let failParent = true;
    const fb = fakeBackend((c) => {
      if (c.table === 'patrol_incidents' && failParent) throw new BackendError('500', 'server', 500);
    });
    const parent = await enqueue({ userId: U, orgId: ORG, kind: 'upsert', table: 'patrol_incidents', payload: { id: 'i1' }, entityKey: 'patrol_incidents:i1', label: 'Incident' });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_attachments', payload: { id: 'a1' }, entityKey: 'patrol_attachments:a1', dependsOn: [parent], label: 'Attachment' });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_scans', payload: { id: 's1' }, entityKey: 'patrol_scans:s1', label: 'Scan' });
    const w = worker(fb.backend);
    await w.kick();
    const tables = fb.calls.map((c) => c.table);
    expect(tables).toContain('patrol_scans');
    expect(tables).not.toContain('patrol_attachments');
    failParent = false;
    await new Promise((r) => setTimeout(r, 500));
    await w.kick();
    await w.idle();
    expect(fb.calls.map((c) => c.table)).toContain('patrol_attachments');
    const attIdx = fb.calls.findIndex((c) => c.table === 'patrol_attachments');
    const lastParent = fb.calls.map((c) => c.table).lastIndexOf('patrol_incidents');
    expect(attIdx).toBeGreaterThan(lastParent);
  });

  it('treats a duplicate-key error as success (idempotent replay)', async () => {
    const fb = fakeBackend(() => { throw new BackendError('23505', 'duplicate key', 409); });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_scans', payload: { id: 's1' }, entityKey: 'patrol_scans:s1', label: 'Scan' });
    await worker(fb.backend).kick();
    expect((await opsForUser(U))[0]!.status).toBe('done');
  });

  it('stops on network errors and keeps ops pending with backoff', async () => {
    const fb = fakeBackend(() => { throw new BackendError('network', 'offline', undefined, true); });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'a', payload: { id: '1' }, entityKey: 'a:1', label: 'a' });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'b', payload: { id: '2' }, entityKey: 'b:2', label: 'b' });
    await worker(fb.backend).kick();
    expect(fb.calls).toHaveLength(1);
    const ops = await opsForUser(U);
    expect(ops.every((o) => o.status === 'pending')).toBe(true);
    expect(ops[0]!.attempts).toBe(1);
    expect(ops[0]!.nextAttemptAt).toBeGreaterThan(Date.now() - 10);
  });

  it('marks validation errors dead immediately and never deletes them', async () => {
    const fb = fakeBackend(() => { throw new BackendError('22P02', 'invalid input syntax', 400); });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'a', payload: { id: '1' }, entityKey: 'a:1', label: 'a' });
    await worker(fb.backend).kick();
    const [op] = await opsForUser(U);
    expect(op!.status).toBe('dead');
    expect(op!.lastError?.message).toContain('invalid input');
    expect((await counts(U)).dead).toBe(1);
  });

  it('gives RLS errors 3 tries before dead', async () => {
    const fb = fakeBackend(() => { throw new BackendError('42501', 'rls', 403); });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'a', payload: { id: '1' }, entityKey: 'a:1', label: 'a' });
    const w = worker(fb.backend);
    for (let i = 0; i < 6; i++) { await w.kick(); await new Promise((r) => setTimeout(r, 450)); }
    expect(fb.calls.length).toBe(3);
    expect((await opsForUser(U))[0]!.status).toBe('dead');
  });

  it('only flushes the active user’s ops (multi-guard device)', async () => {
    const fb = fakeBackend();
    await enqueue({ userId: 'alex', orgId: ORG, kind: 'insert', table: 'a', payload: { id: '1' }, entityKey: 'a:1', label: 'a' });
    await enqueue({ userId: 'sam', orgId: ORG, kind: 'insert', table: 'b', payload: { id: '2' }, entityKey: 'b:2', label: 'b' });
    await worker(fb.backend, 'sam').kick();
    expect(fb.calls.map((c) => c.table)).toEqual(['b']);
    expect((await opsForUser('alex'))[0]!.status).toBe('pending');
  });

  it('runs SOS (priority 0) before older normal ops', async () => {
    const fb = fakeBackend();
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_scans', payload: { id: '1' }, entityKey: 'patrol_scans:1', label: 'scan' });
    await enqueue({ userId: U, orgId: ORG, kind: 'insert', table: 'patrol_alerts', payload: { id: '2' }, entityKey: 'patrol_alerts:2', label: 'SOS', priority: 0 });
    await worker(fb.backend).kick();
    expect(fb.calls[0]!.table).toBe('patrol_alerts');
  });

  it('uploads blobs then marks the attachment uploaded', async () => {
    const fb = fakeBackend();
    const d = await db();
    await d.put('blobs', { id: 'b1', mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 1, 2]).buffer, thumb: new Uint8Array([0xff, 0xd8]).buffer, size: 4, state: 'local', uploadedAt: null, createdAt: Date.now() });
    await enqueue({ userId: U, orgId: ORG, kind: 'upload', payload: { blobId: 'b1', path: 'org/incident/i/a.jpg', thumbPath: 'org/incident/i/a.thumb.jpg', mime: 'image/jpeg', attachmentId: 'a' }, entityKey: 'upload:a', label: 'Photo' });
    await worker(fb.backend).kick();
    expect(fb.calls.map((c) => c.op)).toEqual(['upload', 'upload', 'update']);
    expect((await d.get('blobs', 'b1'))!.state).toBe('uploaded');
  });

  it('pickNext blocks later ops on the same entity behind a dead one', () => {
    const base = { userId: U, orgId: ORG, kind: 'upsert' as const, payload: {}, dependsOn: [], label: '', attempts: 0, nextAttemptAt: 0, createdAt: 0, priority: 5 };
    const ops = [
      { ...base, id: 'a', seq: 1, entityKey: 'x:1', status: 'dead' as const },
      { ...base, id: 'b', seq: 2, entityKey: 'x:1', status: 'pending' as const },
      { ...base, id: 'c', seq: 3, entityKey: 'y:1', status: 'pending' as const },
    ];
    expect(pickNext(ops, Date.now())?.id).toBe('c');
  });
});
