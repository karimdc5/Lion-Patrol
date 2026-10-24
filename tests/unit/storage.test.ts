import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers';
import { durableStorage } from '../../src/auth/storage-adapter';
import { db } from '../../src/data/db';

describe('durable auth storage', () => {
  beforeEach(async () => { await freshDb(); localStorage.clear(); });

  it('writes to localStorage and mirrors to IndexedDB', async () => {
    await durableStorage.setItem('lp-auth', '{"a":1}');
    expect(localStorage.getItem('lp-auth')).toBe('{"a":1}');
    expect((await (await db()).get('session_mirror', 'lp-auth'))?.value).toBe('{"a":1}');
  });

  it('restores from the IndexedDB mirror when localStorage was evicted, and re-hydrates it', async () => {
    await durableStorage.setItem('lp-auth', '{"session":true}');
    localStorage.clear();
    expect(await durableStorage.getItem('lp-auth')).toBe('{"session":true}');
    expect(localStorage.getItem('lp-auth')).toBe('{"session":true}');
  });

  it('removes from both stores', async () => {
    await durableStorage.setItem('lp-auth', 'x');
    await durableStorage.removeItem('lp-auth');
    expect(localStorage.getItem('lp-auth')).toBeNull();
    expect(await durableStorage.getItem('lp-auth')).toBeNull();
  });
});
