import type { Backend } from '../backend/types';
import { BackendError, isNetworkError } from '../backend/types';
import { db } from '../db';
import { classify } from './classify';
import { backoffDelay } from './backoff';
import { opsForUser, putOp, settleRecord, pruneDone } from './queue';
import type { OutboxOp } from './types';

export interface WorkerDeps {
  backend: () => Backend | null;
  userId: () => string | null;
  now?: () => number;
  fastBackoff?: () => boolean;
  onStatus?: (s: WorkerEvent) => void;
}
export type WorkerEvent =
  | { type: 'success'; at: number }
  | { type: 'network-error'; at: number }
  | { type: 'auth-paused' }
  | { type: 'changed' };

/** Single-flight outbox processor. Safe to `kick()` as often as you like. */
export class OutboxWorker {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  authPaused = false;
  private disposed = false;

  constructor(private deps: WorkerDeps) {}

  /** Stop timers and ignore future kicks (tests, backend switch). */
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private now() { return this.deps.now?.() ?? Date.now(); }

  kick(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.withLock(() => this.drain());
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Resolves when the queue is idle (used by tests). */
  async idle() { while (this.running) await this.running; }

  private async withLock(fn: () => Promise<void>) {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (locks?.request) {
      await locks.request('lp-outbox', { mode: 'exclusive' }, fn);
    } else {
      await fn();
    }
  }

  private async drain() {
    const backend = this.deps.backend();
    const userId = this.deps.userId();
    if (!backend || !userId || this.authPaused) return;
    for (let guard = 0; guard < 500; guard++) {
      const ops = await opsForUser(userId);
      const next = pickNext(ops, this.now());
      if (!next) { this.schedule(ops); break; }
      const ok = await this.run(next, backend);
      this.deps.onStatus?.({ type: 'changed' });
      if (ok === 'stop') { this.schedule(await opsForUser(userId)); break; }
    }
    await pruneDone(this.now());
  }

  private schedule(ops: OutboxOp[]) {
    if (this.timer) clearTimeout(this.timer);
    if (this.disposed) return;
    const waiting = ops.filter((o) => o.status === 'pending' && o.nextAttemptAt > this.now());
    if (!waiting.length) return;
    const soonest = Math.min(...waiting.map((o) => o.nextAttemptAt));
    this.timer = setTimeout(() => void this.kick(), Math.max(50, soonest - this.now()));
  }

  private async run(op: OutboxOp, backend: Backend): Promise<'ok' | 'stop' | 'continue'> {
    await putOp({ ...op, status: 'inflight' });
    try {
      await execute(op, backend);
      await putOp({ ...op, status: 'done', doneAt: this.now(), lastError: undefined });
      await settleRecord(op.entityKey);
      this.deps.onStatus?.({ type: 'success', at: this.now() });
      return 'ok';
    } catch (e) {
      let verdict = classify(e);
      if (verdict.action === 'refresh') {
        const fresh = await backend.auth.ensureFresh().catch(() => null);
        if (fresh) {
          try {
            await execute(op, backend);
            await putOp({ ...op, status: 'done', doneAt: this.now() });
            await settleRecord(op.entityKey);
            this.deps.onStatus?.({ type: 'success', at: this.now() });
            return 'ok';
          } catch (e2) {
            e = e2;
            verdict = classify(e2);
          }
        }
        if (verdict.action === 'refresh') {
          if (isNetworkError(e)) verdict = { action: 'retry' };
          else {
            this.authPaused = true;
            await putOp({ ...op, status: 'pending', lastError: errInfo(e, this.now()) });
            this.deps.onStatus?.({ type: 'auth-paused' });
            return 'stop';
          }
        }
      }
      const attempts = op.attempts + 1;
      if (verdict.action === 'success') {
        await putOp({ ...op, status: 'done', doneAt: this.now(), attempts });
        await settleRecord(op.entityKey);
        return 'ok';
      }
      const lastError = errInfo(e, this.now());
      if (verdict.action === 'dead' || (verdict.action === 'retry-limited' && attempts >= verdict.max)) {
        const reason = verdict.action === 'dead' ? verdict.reason : lastError.message;
        await putOp({ ...op, status: 'dead', attempts, lastError: { ...lastError, message: reason } });
        return 'continue';
      }
      const delay = backoffDelay(attempts, Math.random, this.deps.fastBackoff?.() ?? false);
      await putOp({ ...op, status: 'pending', attempts, nextAttemptAt: this.now() + delay, lastError });
      if (isNetworkError(e)) {
        this.deps.onStatus?.({ type: 'network-error', at: this.now() });
        return 'stop'; // everything else would fail too
      }
      return 'continue';
    }
  }
}

function errInfo(e: unknown, at: number) {
  if (e instanceof BackendError) return { code: e.code, message: e.message, http: e.http, at };
  return { code: 'unknown', message: (e as Error)?.message ?? String(e), at };
}

/** Choose the next runnable op: deps done, earlier ops on the same entity finished, not in backoff. */
export function pickNext(ops: OutboxOp[], now: number): OutboxOp | undefined {
  const byId = new Map(ops.map((o) => [o.id, o]));
  const sorted = [...ops].sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  for (const op of sorted) {
    if (op.status !== 'pending' || op.nextAttemptAt > now) continue;
    const depsOk = op.dependsOn.every((d) => {
      const dep = byId.get(d);
      return !dep || dep.status === 'done';
    });
    if (!depsOk) continue;
    const earlierSameEntity = ops.some(
      (o) => o.entityKey === op.entityKey && o.seq < op.seq && (o.status === 'pending' || o.status === 'inflight' || o.status === 'dead'),
    );
    if (earlierSameEntity) continue;
    return op;
  }
  return undefined;
}

async function execute(op: OutboxOp, backend: Backend) {
  switch (op.kind) {
    case 'insert': {
      const rows = Array.isArray(op.payload) ? op.payload : [op.payload];
      return backend.insert(op.table!, rows as object[], { ignoreDuplicates: true });
    }
    case 'upsert': {
      const rows = Array.isArray(op.payload) ? op.payload : [op.payload];
      return backend.upsert(op.table!, rows as object[]);
    }
    case 'update':
      return backend.update(op.table!, op.payload as object, op.match ?? {});
    case 'rpc':
      await backend.rpc(op.rpc!, (op.payload ?? {}) as Record<string, unknown>);
      return;
    case 'upload': {
      const p = op.payload as { blobId: string; path: string; thumbPath?: string | null; mime: string; attachmentId: string };
      const d = await db();
      const blob = await d.get('blobs', p.blobId);
      if (!blob) throw new BackendError('blob_missing', 'The file is no longer on this device.', 400);
      if (blob.state !== 'uploaded') {
        await d.put('blobs', { ...blob, state: 'uploading' });
        await backend.storage.upload(p.path, blob.bytes, p.mime);
        if (p.thumbPath && blob.thumb) await backend.storage.upload(p.thumbPath, blob.thumb, 'image/jpeg');
        await d.put('blobs', { ...blob, state: 'uploaded', uploadedAt: Date.now() });
      }
      await backend.update('patrol_attachments', { upload_status: 'uploaded', uploaded_at: new Date().toISOString() }, { id: p.attachmentId });
      return;
    }
  }
}
