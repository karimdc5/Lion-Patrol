import type { Backend } from './types';
import { setDbName } from '../db';

export type BackendMode = 'supabase' | 'demo' | 'memory';
const MODE_KEY = 'lp-mode';

/** Resolve which backend this page load uses. `?demo=1` and (dev/e2e only) `?backend=memory` stick across reloads. */
export function resolveMode(): BackendMode {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') localStorage.setItem(MODE_KEY, 'demo');
  if (params.get('demo') === '0') localStorage.removeItem(MODE_KEY);
  if ((__E2E__ || import.meta.env.DEV) && params.get('backend') === 'memory') localStorage.setItem(MODE_KEY, 'memory');
  const m = localStorage.getItem(MODE_KEY);
  if (m === 'demo') return 'demo';
  if (m === 'memory' && (__E2E__ || import.meta.env.DEV)) return 'memory';
  return 'supabase';
}

export function setMode(mode: BackendMode) {
  if (mode === 'supabase') localStorage.removeItem(MODE_KEY);
  else localStorage.setItem(MODE_KEY, mode);
}

export function authKeyFor(mode: BackendMode) {
  return mode === 'supabase' ? 'lp-auth' : mode === 'demo' ? 'lp-auth-demo' : 'lp-auth-mem';
}

export async function createBackend(mode: BackendMode): Promise<Backend> {
  setDbName(mode === 'supabase' ? 'lion-patrol' : mode === 'demo' ? 'lion-patrol-demo' : 'lion-patrol-mem');
  if (mode === 'supabase') {
    const { createSupabaseBackend } = await import('./supabase');
    return createSupabaseBackend();
  }
  const [{ createMemoryBackend }, { demoSeed }] = await Promise.all([import('./memory'), import('../demo/seed')]);
  return createMemoryBackend({
    storageKey: mode === 'demo' ? 'lp-demo-server' : 'lp-mock-server',
    authKey: authKeyFor(mode),
    seed: () => demoSeed(),
  });
}
