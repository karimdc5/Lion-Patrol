import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OutboxOp } from './outbox/types';

export type Row = Record<string, unknown> & { id: string };
export interface CachedRecord {
  table: string;
  id: string;
  orgId: string | null;
  parentId: string | null;
  updatedAt: string;
  _pending: 0 | 1;
  _localRev: number;
  data: Row;
}
export interface BlobRecord {
  id: string;
  mime: string;
  bytes: ArrayBuffer;
  thumb: ArrayBuffer | null;
  size: number;
  state: 'local' | 'uploading' | 'uploaded';
  uploadedAt: number | null;
  createdAt: number;
}
export interface VaultEntry {
  userId: string;
  email: string;
  displayName: string;
  orgName: string;
  role: string;
  salt: string;
  iterations: number;
  verifier: string;
  iv: string;
  ciphertext: string;
  failedAttempts: number;
  lockedUntil: number;
  createdAt: number;
  lastUsedAt: number;
}
export interface IdentityRecord {
  userId: string;
  email: string;
  isAppAdmin: boolean;
  memberships: Row[];
  updatedAt: number;
}
export interface DraftRecord { id: string; userId: string; kind: string; data: unknown; updatedAt: number }

interface LionDB extends DBSchema {
  kv: { key: string; value: { key: string; value: unknown } };
  session_mirror: { key: string; value: { key: string; value: string } };
  vault: { key: string; value: VaultEntry };
  identity: { key: string; value: IdentityRecord };
  records: {
    key: [string, string];
    value: CachedRecord;
    indexes: { byTableOrg: [string, string]; byTableParent: [string, string]; byPending: number; byTable: string };
  };
  drafts: { key: string; value: DraftRecord; indexes: { byUser: string } };
  outbox: {
    key: string;
    value: OutboxOp;
    indexes: { bySeq: number; byUserStatus: [string, string]; byEntity: string; byStatus: string };
  };
  blobs: { key: string; value: BlobRecord; indexes: { byState: string } };
  tus: { key: string; value: { key: string; value: unknown } };
  thumb_cache: { key: string; value: { key: string; bytes: ArrayBuffer; mime: string; lastUsed: number }; indexes: { byLastUsed: number } };
}

export type LDB = IDBPDatabase<LionDB>;
let dbp: Promise<LDB> | null = null;
let dbName = 'lion-patrol';

export function setDbName(name: string) {
  if (dbName !== name) { dbName = name; dbp = null; }
}
export function getDbName() { return dbName; }

export function db(): Promise<LDB> {
  if (!dbp) {
    dbp = openDB<LionDB>(dbName, 1, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('kv', { keyPath: 'key' });
          d.createObjectStore('session_mirror', { keyPath: 'key' });
          d.createObjectStore('vault', { keyPath: 'userId' });
          d.createObjectStore('identity', { keyPath: 'userId' });
          const rec = d.createObjectStore('records', { keyPath: ['table', 'id'] });
          rec.createIndex('byTableOrg', ['table', 'orgId']);
          rec.createIndex('byTableParent', ['table', 'parentId']);
          rec.createIndex('byPending', '_pending');
          rec.createIndex('byTable', 'table');
          const dr = d.createObjectStore('drafts', { keyPath: 'id' });
          dr.createIndex('byUser', 'userId');
          const ob = d.createObjectStore('outbox', { keyPath: 'id' });
          ob.createIndex('bySeq', 'seq');
          ob.createIndex('byUserStatus', ['userId', 'status']);
          ob.createIndex('byEntity', 'entityKey');
          ob.createIndex('byStatus', 'status');
          const bl = d.createObjectStore('blobs', { keyPath: 'id' });
          bl.createIndex('byState', 'state');
          d.createObjectStore('tus', { keyPath: 'key' });
          const tc = d.createObjectStore('thumb_cache', { keyPath: 'key' });
          tc.createIndex('byLastUsed', 'lastUsed');
        }
      },
      blocked() { /* another tab holds an older version; it will reload on versionchange */ },
      blocking() { dbp?.then((d) => d.close()); dbp = null; },
    });
  }
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const r = await (await db()).get('kv', key);
  return r?.value as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', { key, value });
}
export async function kvDel(key: string): Promise<void> {
  await (await db()).delete('kv', key);
}

/** Test helper: drop the connection so a fresh fake-indexeddb can be used. */
export async function _resetDbForTests(name = 'lion-patrol-test') {
  if (dbp) (await dbp).close();
  dbp = null;
  dbName = name;
}
