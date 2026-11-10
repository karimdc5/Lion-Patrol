import { db } from '../data/db';

/**
 * Durable auth storage: localStorage (sync, fast) mirrored to IndexedDB (survives Safari
 * evicting one store). Reads fall back to the mirror and re-hydrate localStorage.
 */
export const durableStorage = {
  async getItem(key: string): Promise<string | null> {
    let v: string | null = null;
    try { v = localStorage.getItem(key); } catch { /* private mode */ }
    if (v != null) return v;
    try {
      const rec = await (await db()).get('session_mirror', key);
      if (rec?.value) {
        try { localStorage.setItem(key, rec.value); } catch { /* ignore */ }
        return rec.value;
      }
    } catch { /* idb unavailable */ }
    return null;
  },
  async setItem(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
    try { await (await db()).put('session_mirror', { key, value }); } catch { /* ignore */ }
  },
  async removeItem(key: string): Promise<void> {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    try { await (await db()).delete('session_mirror', key); } catch { /* ignore */ }
  },
};
