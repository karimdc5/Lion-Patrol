import { GoTrueClient, type Session } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';
import { StorageClient } from '@supabase/storage-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STORAGE_BUCKET } from '../../config';
import { durableStorage } from '../../auth/storage-adapter';
import { BackendError, type AuthApi, type AuthEvent, type Backend, type SelectQuery, type StoredSession } from './types';

const STORAGE_KEY = 'lp-auth';
/** Tables whose primary key isn't `id`. */
const CONFLICT: Record<string, string> = {
  patrol_site_access: 'site_id,member_id', patrol_org_settings: 'org_id', patrol_member_status: 'member_id',
  patrol_guard_cards: 'member_id', patrol_site_codes: 'site_id', patrol_site_billing: 'site_id', patrol_org_billing: 'org_id', patrol_post_order_acks: 'member_id,site_id',
};
const TIMEOUT_MS = 15_000;

function toStored(s: Session | null): StoredSession | null {
  if (!s) return null;
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
    expires_in: s.expires_in,
    token_type: s.token_type,
    user: { ...(s.user as unknown as Record<string, unknown>), id: s.user.id, email: s.user.email ?? '' },
  };
}

function normalize(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  const anyE = e as { code?: string; message?: string; status?: number; name?: string; details?: string };
  if (e instanceof TypeError || anyE?.name === 'AbortError' || /fetch|network|load failed/i.test(anyE?.message ?? '')) {
    return new BackendError('network', anyE?.message ?? 'Network error', undefined, true);
  }
  return new BackendError(String(anyE?.code ?? anyE?.status ?? 'unknown'), anyE?.message ?? String(e), anyE?.status);
}

export function createSupabaseBackend(): Backend {
  const gotrue = new GoTrueClient({
    url: `${SUPABASE_URL}/auth/v1`,
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    storageKey: STORAGE_KEY,
    storage: durableStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  });

  const authedFetch: typeof fetch = async (input, init = {}) => {
    const { data } = await gotrue.getSession();
    const headers = new Headers(init.headers);
    headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
    if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, headers, signal: init.signal ?? ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };

  const rest = new PostgrestClient(`${SUPABASE_URL}/rest/v1`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, fetch: authedFetch });
  const storage = new StorageClient(`${SUPABASE_URL}/storage/v1`, { apikey: SUPABASE_PUBLISHABLE_KEY }, authedFetch);

  async function check<T>(p: PromiseLike<{ data: T; error: unknown; status?: number }>): Promise<T> {
    let res;
    try { res = await p; } catch (e) { throw normalize(e); }
    if (res.error) {
      const err = res.error as { code?: string; message?: string };
      if (!err.code && /fetch|network|load failed/i.test(err.message ?? '')) throw new BackendError('network', err.message ?? 'Network error', undefined, true);
      throw new BackendError(err.code ?? String(res.status ?? 'error'), err.message ?? 'Request failed', res.status);
    }
    return res.data;
  }

  const auth: AuthApi = {
    async getSession() {
      try {
        const { data } = await gotrue.getSession();
        if (data.session) return toStored(data.session);
      } catch { /* fall through */ }
      const raw = await durableStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    },
    async signIn(email, password) {
      const { data, error } = await gotrue.signInWithPassword({ email, password });
      if (error) throw new BackendError(error.code ?? String(error.status ?? 'auth'), error.message, error.status, error.name === 'AuthRetryableFetchError');
      return toStored(data.session)!;
    },
    async signUp(email, password, meta) {
      const { data, error } = await gotrue.signUp({ email, password, options: { data: meta } });
      if (error) throw new BackendError(error.code ?? String(error.status ?? 'auth'), error.message, error.status, error.name === 'AuthRetryableFetchError');
      return toStored(data.session);
    },
    async signOut(scope) {
      try { await gotrue.signOut({ scope }); } catch { /* offline: local clear below */ }
      await durableStorage.removeItem(STORAGE_KEY);
    },
    async adopt(session) {
      await durableStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      // Let GoTrue pick it up (refreshes when online and expired; keeps it when offline).
      try { await gotrue.getSession(); } catch { /* offline */ }
    },
    async ensureFresh() {
      try {
        const { data } = await gotrue.getSession();
        const s = data.session;
        if (!s) return null;
        if ((s.expires_at ?? 0) * 1000 - Date.now() > 120_000) return toStored(s);
        const r = await gotrue.refreshSession();
        if (r.error) {
          if (r.error.name === 'AuthRetryableFetchError') return null;
          throw new BackendError(r.error.code ?? 'refresh_failed', r.error.message, r.error.status);
        }
        return toStored(r.data.session);
      } catch (e) {
        if (e instanceof BackendError) throw e;
        return null;
      }
    },
    onChange(cb) {
      const { data } = gotrue.onAuthStateChange((event, session) => cb(event as AuthEvent, toStored(session)));
      return () => data.subscription.unsubscribe();
    },
  };

  return {
    kind: 'supabase',
    auth,
    async select<T>(table: string, q: SelectQuery = {}) {
      let b = rest.from(table).select(q.columns ?? '*');
      for (const [k, v] of Object.entries(q.eq ?? {})) b = v === null ? b.is(k, null) : b.eq(k, v);
      for (const [k, v] of Object.entries(q.in ?? {})) b = b.in(k, v);
      for (const [k, v] of Object.entries(q.gt ?? {})) b = b.gt(k, v);
      for (const [k, v] of Object.entries(q.gte ?? {})) b = b.gte(k, v);
      if (q.order) b = b.order(q.order[0], { ascending: q.order[1] === 'asc' });
      if (q.limit) b = b.limit(q.limit);
      return (await check(b)) as unknown as T[];
    },
    async insert(table, rows, opts) {
      if (opts?.ignoreDuplicates) {
        await check(rest.from(table).upsert(rows, { onConflict: CONFLICT[table] ?? 'id', ignoreDuplicates: true }));
      } else {
        await check(rest.from(table).insert(rows));
      }
    },
    async upsert(table, rows) {
      await check(rest.from(table).upsert(rows, { onConflict: CONFLICT[table] ?? 'id' }));
    },
    async update(table, patch, eq) {
      let b = rest.from(table).update(patch);
      for (const [k, v] of Object.entries(eq)) b = b.eq(k, v);
      await check(b);
    },
    async remove(table, eq) {
      let b = rest.from(table).delete();
      for (const [k, v] of Object.entries(eq)) b = b.eq(k, v);
      await check(b);
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      return (await check(rest.rpc(fn, args))) as T;
    },
    storage: {
      async upload(path, bytes, mime) {
        const { error } = await storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '3600' });
        if (error) {
          const status = Number((error as { statusCode?: string }).statusCode ?? 0) || undefined;
          throw new BackendError(String(status ?? 'storage'), error.message, status, /fetch|network/i.test(error.message));
        }
      },
      async signedUrls(paths, ttl) {
        if (!paths.length) return {};
        const { data, error } = await storage.from(STORAGE_BUCKET).createSignedUrls(paths, ttl);
        if (error) throw normalize(error);
        const out: Record<string, string> = {};
        for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
        return out;
      },
    },
  };
}
