import { useEffect } from 'preact/hooks';
import { refreshDashboard } from '../../data/admin';
import { currentOrgId } from '../../auth/session';
import { subscribeOrg } from '../../data/realtime';
import { checkOwnerAlerts, fetchOwnerAlerts } from '../../data/ownerAlerts';

/** Keep staff data fresh: initial pull, realtime nudges (Supabase), 15s polling fallback. */
export function useOpsRefresh() {
  const org = currentOrgId.value;
  useEffect(() => {
    if (!org) return;
    let timer = 0;
    const debounced = () => { clearTimeout(timer); timer = window.setTimeout(() => void refreshDashboard(), 400); };
    const owners = async () => { await checkOwnerAlerts(); await fetchOwnerAlerts(); };
    void refreshDashboard();
    void owners();
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') { void refreshDashboard(); void owners(); } }, 15_000);
    let unsub: (() => void) | null = null;
    void subscribeOrg(org, debounced).then((u) => { unsub = u; }).catch(() => undefined);
    const onVis = () => { if (document.visibilityState === 'visible') debounced(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(poll); clearTimeout(timer); unsub?.(); document.removeEventListener('visibilitychange', onVis); };
  }, [org]);
}
