import { signal, computed } from '@preact/signals';

export const net = signal({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastNetworkErrorAt: 0,
  lastSuccessAt: 0,
});
export const queue = signal({ pending: 0, inflight: 0, dead: 0 });
export const authPaused = signal(false);
export const lastSyncAt = signal<number>(0);

export type SyncState = 'offline' | 'error' | 'syncing' | 'pending' | 'synced';

export const syncState = computed<SyncState>(() => {
  const n = net.value;
  const q = queue.value;
  const recentNetErr = n.lastNetworkErrorAt > n.lastSuccessAt && Date.now() - n.lastNetworkErrorAt < 30_000;
  if (!n.online || recentNetErr) return 'offline';
  if (q.dead > 0 || authPaused.value) return 'error';
  if (q.inflight > 0) return 'syncing';
  if (q.pending > 0) return 'pending';
  return 'synced';
});

export const syncLabel = computed(() => {
  const q = queue.value;
  const total = q.pending + q.inflight;
  switch (syncState.value) {
    case 'offline': return total ? `Offline · ${total} pending` : 'Offline';
    case 'error': return authPaused.value ? 'Sign in to sync' : `Error · tap`;
    case 'syncing': return `Syncing ${total}`;
    case 'pending': return `${total} pending`;
    default: return 'Synced';
  }
});
