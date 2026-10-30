import { db, type VaultEntry } from '../data/db';
import { toB64, fromB64, timingSafeEqual } from '../lib/bytes';
import { PIN_ITERATIONS } from '../config';
import type { StoredSession } from '../data/backend/types';

/**
 * Remembered-device vault. Each guard's session is encrypted with a key derived from their
 * 4–6 digit PIN (PBKDF2-SHA256 → 512 bits: 256 verifier + 256 AES-GCM key). The PIN never
 * leaves the device. The derived key stays in memory (non-extractable) while that guard is
 * active so refreshed tokens can be re-wrapped.
 */
export interface VaultProfile { userId: string; email: string; displayName: string; orgName: string; role: string }
export type UnlockError =
  | { code: 'wrong_pin'; remaining: number; lockedUntil: number }
  | { code: 'locked'; lockedUntil: number }
  | { code: 'wiped' }
  | { code: 'not_found' };

export const MAX_ATTEMPTS = 10;
const keys = new Map<string, CryptoKey>();
let iterations = PIN_ITERATIONS;
let clock = () => Date.now();

export function _setVaultTestOptions(o: { iterations?: number; now?: () => number }) {
  if (o.iterations) iterations = o.iterations;
  if (o.now) clock = o.now;
}

export function validPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** Lockout ladder after N consecutive failures. */
export function lockoutMs(failures: number): number {
  if (failures < 5) return 0;
  if (failures === 5) return 30_000;
  if (failures === 6) return 60_000;
  if (failures === 7) return 5 * 60_000;
  return 15 * 60_000;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iters: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, base, 512));
  const verifier = bits.slice(0, 32);
  const key = await crypto.subtle.importKey('raw', bits.slice(32, 64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { verifier, key };
}

async function encrypt(key: CryptoKey, session: StoredSession) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(session)));
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

export async function enroll(profile: VaultProfile, pin: string, session: StoredSession): Promise<void> {
  if (!validPin(pin)) throw new Error('PIN must be 4–6 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { verifier, key } = await derive(pin, salt, iterations);
  const enc = await encrypt(key, session);
  const entry: VaultEntry = {
    ...profile,
    salt: toB64(salt),
    iterations,
    verifier: toB64(verifier),
    ...enc,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: clock(),
    lastUsedAt: clock(),
  };
  await (await db()).put('vault', entry);
  keys.set(profile.userId, key);
}

export async function unlock(userId: string, pin: string): Promise<{ ok: true; session: StoredSession } | ({ ok: false } & UnlockError)> {
  const d = await db();
  const entry = await d.get('vault', userId);
  if (!entry) return { ok: false, code: 'not_found' };
  const now = clock();
  if (entry.lockedUntil > now) return { ok: false, code: 'locked', lockedUntil: entry.lockedUntil };
  const { verifier, key } = await derive(pin, fromB64(entry.salt), entry.iterations);
  if (!timingSafeEqual(verifier, fromB64(entry.verifier))) {
    const failures = entry.failedAttempts + 1;
    if (failures >= MAX_ATTEMPTS) {
      await d.delete('vault', userId);
      keys.delete(userId);
      return { ok: false, code: 'wiped' };
    }
    const lockedUntil = lockoutMs(failures) ? now + lockoutMs(failures) : 0;
    await d.put('vault', { ...entry, failedAttempts: failures, lockedUntil });
    return { ok: false, code: 'wrong_pin', remaining: MAX_ATTEMPTS - failures, lockedUntil };
  }
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(entry.iv) }, key, fromB64(entry.ciphertext));
  const session = JSON.parse(new TextDecoder().decode(plain)) as StoredSession;
  await d.put('vault', { ...entry, failedAttempts: 0, lockedUntil: 0, lastUsedAt: now });
  keys.set(userId, key);
  return { ok: true, session };
}

/** Re-encrypt the latest tokens (called on every token refresh while the key is in memory). */
export async function rewrap(userId: string, session: StoredSession): Promise<boolean> {
  const key = keys.get(userId);
  if (!key) return false;
  const d = await db();
  const entry = await d.get('vault', userId);
  if (!entry) return false;
  const enc = await encrypt(key, session);
  await d.put('vault', { ...entry, ...enc });
  return true;
}

export function hasKey(userId: string) { return keys.has(userId); }
export function forgetKey(userId: string) { keys.delete(userId); }

export async function list(): Promise<Array<Omit<VaultEntry, 'salt' | 'verifier' | 'iv' | 'ciphertext'>>> {
  const entries = await (await db()).getAll('vault');
  return entries
    .map(({ salt: _s, verifier: _v, iv: _i, ciphertext: _c, ...rest }) => rest)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function isEnrolled(userId: string) {
  return !!(await (await db()).get('vault', userId));
}

export async function remove(userId: string) {
  await (await db()).delete('vault', userId);
  keys.delete(userId);
}
