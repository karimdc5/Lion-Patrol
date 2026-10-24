import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config';
import { getBackend } from '../auth/session';

const TABLES = ['patrol_member_status', 'patrol_alerts', 'patrol_incidents', 'patrol_scans', 'patrol_dar_entries'];

/**
 * Subscribe staff dashboards to live changes. Supabase only; realtime-js is lazy-loaded so it
 * never touches the guard bundle. Any change just triggers `onChange` (a debounced refresh).
 * Returns an unsubscribe function. Polling remains the fallback in every mode.
 */
export async function subscribeOrg(orgId: string, onChange: () => void): Promise<() => void> {
  const backend = getBackend();
  if (backend.kind !== 'supabase') return () => {};
  const session = await backend.auth.getSession();
  if (!session) return () => {};
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const client = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, { params: { apikey: SUPABASE_PUBLISHABLE_KEY } });
  client.setAuth(session.access_token);
  let ch = client.channel(`patrol:${orgId}`);
  for (const table of TABLES) {
    ch = ch.on('postgres_changes' as never, { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` } as never, () => onChange());
  }
  ch.subscribe();
  return () => { void client.removeChannel(ch); client.disconnect(); };
}
