import { BackendError, isNetworkError } from '../backend/types';

export type Verdict =
  | { action: 'success' }
  | { action: 'retry' }
  | { action: 'refresh' }         // auth expired — refresh, then retry now
  | { action: 'retry-limited'; max: number }
  | { action: 'dead'; reason: string };

/** Map a backend error to what the outbox should do. Pure; unit tested. */
export function classify(e: unknown): Verdict {
  if (isNetworkError(e)) return { action: 'retry' };
  const err = e instanceof BackendError ? e : new BackendError('unknown', String((e as Error)?.message ?? e));
  const { code, http } = err;
  if (code === '23505' || http === 409) return { action: 'success' };       // already applied
  if (code === 'PGRST301' || code === 'PGRST303' || http === 401 || /jwt expired/i.test(err.message)) return { action: 'refresh' };
  if (http === 408 || http === 429 || (http !== undefined && http >= 500)) return { action: 'retry' };
  if (code === '42501' || http === 403) return { action: 'retry-limited', max: 3 };
  if (code === '23503') return { action: 'retry-limited', max: 5 };          // parent not there yet
  if (code === 'P0001') return { action: 'dead', reason: humanize(err.message) };
  if (/^22|^23502|^23514|^PGRST1/.test(code) || http === 400) return { action: 'dead', reason: humanize(err.message) };
  return { action: 'retry-limited', max: 8 };
}

export function humanize(msg: string): string {
  const map: Record<string, string> = {
    not_editable: 'This report was already submitted and can no longer be edited.',
    dar_not_open: 'This shift log was already closed.',
    checkpoint_site_mismatch: 'That checkpoint belongs to a different site.',
    attachment_not_allowed: 'You can’t attach files to this record.',
  };
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k]!;
  return msg;
}
