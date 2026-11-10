import { BackendError, isNetworkError } from '../backend/types';

export type Verdict =
  | { action: 'success' }
  | { action: 'retry' }
  | { action: 'refresh' }         // auth expired — refresh, then retry now
  | { action: 'retry-limited'; max: number }
  | { action: 'dead'; reason: string };

/** The parts of an outbox op that decide dedupe (B3). */
export interface OpShape { kind?: string; table?: string; payload?: unknown }

/**
 * B3: a "submit" of a report the server already holds as submitted is a duplicate, not a failure —
 * e.g. clock-out and the DAR screen both submitting the same daily report. The server copy wins.
 */
export function isDuplicateSubmit(msg: string, op?: OpShape): boolean {
  if (!op || op.kind !== 'update' || !/not_editable|dar_not_open|already submitted|already closed/.test(msg)) return false;
  const status = (op.payload as { status?: unknown } | null)?.status;
  return (op.table === 'patrol_dars' || op.table === 'patrol_incidents') && status === 'submitted';
}

/** Map a backend error to what the outbox should do. Pure; unit tested. */
export function classify(e: unknown, op?: OpShape): Verdict {
  if (isNetworkError(e)) return { action: 'retry' };
  const err = e instanceof BackendError ? e : new BackendError('unknown', String((e as Error)?.message ?? e));
  const { code, http } = err;
  if (code === '23505' || http === 409) return { action: 'success' };       // already applied
  if (isDuplicateSubmit(err.message, op)) return { action: 'success' };     // already submitted (B3)
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
    outside_geofence: 'Clock-in rejected: you were outside the site’s geofence.',
    clock_in_gps_required: 'Clock-in rejected: location is required at this site.',
    site_has_time_records: 'This site has time records (kept 3 years). Mark it inactive instead of deleting it.',
  };
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k]!;
  return msg;
}
