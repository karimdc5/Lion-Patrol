import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers';
import * as vault from '../../src/auth/vault';
import { db } from '../../src/data/db';
import type { StoredSession } from '../../src/data/backend/types';

const sess = (id: string, tok = 'refresh-1'): StoredSession => ({ access_token: 'acc-' + tok, refresh_token: tok, expires_at: 9e9, user: { id, email: `${id}@x.test` } });
const profile = (id: string) => ({ userId: id, email: `${id}@x.test`, displayName: id, orgName: 'Lion', role: 'guard' });
let now = 1_000_000;

describe('PIN vault', () => {
  beforeEach(async () => {
    await freshDb();
    now = 1_000_000;
    vault._setVaultTestOptions({ iterations: 1000, now: () => now });
  });

  it('validates PIN format', () => {
    expect(vault.validPin('1234')).toBe(true);
    expect(vault.validPin('123456')).toBe(true);
    expect(vault.validPin('123')).toBe(false);
    expect(vault.validPin('1234567')).toBe(false);
    expect(vault.validPin('12a4')).toBe(false);
  });

  it('unlocks with the right PIN and returns the stored session; never stores the PIN or tokens in clear', async () => {
    await vault.enroll(profile('alex'), '4821', sess('alex'));
    const raw = await (await db()).get('vault', 'alex');
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain('4821');
    expect(dump).not.toContain('refresh-1');
    vault.forgetKey('alex');
    const res = await vault.unlock('alex', '4821');
    expect(res.ok && res.session.refresh_token).toBe('refresh-1');
  });

  it('rejects a wrong PIN and counts attempts', async () => {
    await vault.enroll(profile('alex'), '4821', sess('alex'));
    const res = await vault.unlock('alex', '0000');
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === 'wrong_pin') expect(res.remaining).toBe(9);
  });

  it('applies the lockout ladder and persists lockedUntil', async () => {
    await vault.enroll(profile('alex'), '4821', sess('alex'));
    for (let i = 0; i < 4; i++) await vault.unlock('alex', '0000');
    const fifth = await vault.unlock('alex', '0000');
    expect(!fifth.ok && fifth.code === 'wrong_pin' && fifth.lockedUntil).toBe(now + 30_000);
    const locked = await vault.unlock('alex', '4821');
    expect(!locked.ok && locked.code).toBe('locked');
    now += 31_000;
    const ok = await vault.unlock('alex', '4821');
    expect(ok.ok).toBe(true);
    const entry = await (await db()).get('vault', 'alex');
    expect(entry!.failedAttempts).toBe(0);
  });

  it('ladder values', () => {
    expect([4, 5, 6, 7, 8, 9].map(vault.lockoutMs)).toEqual([0, 30_000, 60_000, 300_000, 900_000, 900_000]);
  });

  it('wipes the entry after 10 consecutive failures', async () => {
    await vault.enroll(profile('alex'), '4821', sess('alex'));
    let last;
    for (let i = 0; i < 10; i++) { last = await vault.unlock('alex', '9999'); now += 16 * 60_000; }
    expect(!last!.ok && last!.code).toBe('wiped');
    expect(await vault.isEnrolled('alex')).toBe(false);
  });

  it('re-wraps refreshed tokens while the key is in memory', async () => {
    await vault.enroll(profile('alex'), '4821', sess('alex'));
    expect(await vault.rewrap('alex', sess('alex', 'refresh-2'))).toBe(true);
    vault.forgetKey('alex');
    expect(await vault.rewrap('alex', sess('alex', 'refresh-3'))).toBe(false);
    const res = await vault.unlock('alex', '4821');
    expect(res.ok && res.session.refresh_token).toBe('refresh-2');
  });

  it('keeps multiple guards isolated on one device', async () => {
    await vault.enroll(profile('alex'), '1111', sess('alex', 'ra'));
    await vault.enroll(profile('sam'), '2222', sess('sam', 'rs'));
    expect((await vault.list()).map((e) => e.userId).sort()).toEqual(['alex', 'sam']);
    expect((await vault.unlock('alex', '2222')).ok).toBe(false);
    const sam = await vault.unlock('sam', '2222');
    expect(sam.ok && sam.session.refresh_token).toBe('rs');
    const listed = await vault.list();
    expect(JSON.stringify(listed)).not.toMatch(/ciphertext|verifier|salt/);
  });
});
