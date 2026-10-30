import { _resetDbForTests } from '../../src/data/db';
import { BackendError, type Backend } from '../../src/data/backend/types';

let n = 0;
export async function freshDb() {
  await _resetDbForTests(`lp-test-${Date.now()}-${n++}`);
}

export interface FakeCall { op: string; table?: string; payload?: unknown }
export function fakeBackend(behaviour: (call: FakeCall) => void | Promise<void> = () => {}) {
  const calls: FakeCall[] = [];
  const rows: Record<string, Map<string, Record<string, unknown>>> = {};
  const record = async (call: FakeCall) => { calls.push(call); await behaviour(call); };
  const backend: Backend = {
    kind: 'memory',
    auth: {
      getSession: async () => null,
      signIn: async () => { throw new Error('n/a'); },
      signUp: async () => null,
      signOut: async () => {},
      adopt: async () => {},
      ensureFresh: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: 9e9, user: { id: 'u', email: 'e' } }),
      onChange: () => () => {},
    },
    select: async () => [],
    insert: async (table, list, opts) => {
      await record({ op: 'insert', table, payload: list });
      const m = (rows[table] ??= new Map());
      for (const r of list as Array<{ id: string }>) {
        if (m.has(r.id) && !opts?.ignoreDuplicates) throw new BackendError('23505', 'duplicate', 409);
        if (!m.has(r.id)) m.set(r.id, r);
      }
    },
    upsert: async (table, list) => {
      await record({ op: 'upsert', table, payload: list });
      const m = (rows[table] ??= new Map());
      for (const r of list as Array<{ id: string }>) m.set(r.id, { ...(m.get(r.id) ?? {}), ...r });
    },
    update: async (table, patch) => { await record({ op: 'update', table, payload: patch }); },
    remove: async () => {},
    rpc: async (fn, args) => { await record({ op: 'rpc', table: fn, payload: args }); return null as never; },
    storage: {
      upload: async (path, bytes) => { await record({ op: 'upload', table: path, payload: bytes.byteLength }); },
      signedUrls: async () => ({}),
    },
  };
  return { backend, calls, rows };
}
