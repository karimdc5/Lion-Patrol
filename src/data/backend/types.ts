export interface AuthUser { id: string; email: string }
export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  expires_in?: number;
  token_type?: string;
  user: AuthUser & Record<string, unknown>;
}
export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'INITIAL_SESSION';

export interface AuthApi {
  /** Local read; never throws for network reasons. */
  getSession(): Promise<StoredSession | null>;
  signIn(email: string, password: string): Promise<StoredSession>;
  /** Returns null when the project requires email confirmation. */
  signUp(email: string, password: string, meta?: Record<string, unknown>): Promise<StoredSession | null>;
  signOut(scope: 'local' | 'global'): Promise<void>;
  /** Make `session` the active session (multi-guard switching). Works offline. */
  adopt(session: StoredSession): Promise<void>;
  /** Refresh if expiring soon. Network failures resolve to null and keep the session. */
  ensureFresh(): Promise<StoredSession | null>;
  onChange(cb: (event: AuthEvent, session: StoredSession | null) => void): () => void;
}

export interface SelectQuery {
  eq?: Record<string, string | number | boolean | null>;
  in?: Record<string, Array<string | number>>;
  gt?: Record<string, string | number>;
  gte?: Record<string, string | number>;
  order?: [string, 'asc' | 'desc'];
  limit?: number;
  columns?: string;
}

export interface StorageApi {
  upload(path: string, bytes: ArrayBuffer, mime: string, onProgress?: (fraction: number) => void): Promise<void>;
  signedUrls(paths: string[], ttlSeconds: number): Promise<Record<string, string>>;
}

export interface Backend {
  kind: 'supabase' | 'memory';
  auth: AuthApi;
  select<T = Record<string, unknown>>(table: string, q?: SelectQuery): Promise<T[]>;
  insert(table: string, rows: object[], opts?: { ignoreDuplicates?: boolean }): Promise<void>;
  upsert(table: string, rows: object[]): Promise<void>;
  update(table: string, patch: object, eq: Record<string, string | number | boolean>): Promise<void>;
  remove(table: string, eq: Record<string, string | number | boolean>): Promise<void>;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  storage: StorageApi;
}

/** Normalised error thrown by every backend call. */
export class BackendError extends Error {
  constructor(
    public code: string,
    message: string,
    public http?: number,
    public network = false,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export function isNetworkError(e: unknown): boolean {
  if (e instanceof BackendError) return e.network;
  if (e instanceof TypeError) return true; // fetch() network failure
  return e instanceof Error && /network|failed to fetch|load failed|offline/i.test(e.message);
}
