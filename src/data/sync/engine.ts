import { OutboxWorker } from '../outbox/worker';
import { counts, resetInflight } from '../outbox/queue';
import { net, queue, authPaused } from './status';
import { runBootstrap } from './bootstrap';
import { kvGet } from '../db';
import { isNetworkError, type Backend } from '../backend/types';

interface EngineDeps {
  backend: () => Backend | null;
  userId: () => string | null;
  email: () => string;
  onBootstrapped?: () => void;
}

const BOOTSTRAP_STALE_MS = 5 * 60 * 1000;
let worker: OutboxWorker | null = null;
let deps: EngineDeps | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let started = false;

export function getWorker() { return worker; }

export async function refreshCounts() {
  queue.value = await counts(deps?.userId() ?? null);
}

export async function startEngine(d: EngineDeps) {
  deps = d;
  await resetInflight();
  worker = new OutboxWorker({
    backend: d.backend,
    userId: d.userId,
    fastBackoff: () => localStorage.getItem('lp-fast-backoff') === '1',
    onStatus: (e) => {
      if (e.type === 'success') net.value = { ...net.value, online: true, lastSuccessAt: e.at };
      if (e.type === 'network-error') net.value = { ...net.value, lastNetworkErrorAt: e.at };
      if (e.type === 'auth-paused') authPaused.value = true;
      void refreshCounts();
    },
  });
  if (started) return;
  started = true;
  const onOnline = () => { net.value = { ...net.value, online: navigator.onLine }; if (navigator.onLine) void syncNow(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOnline);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow({ bootstrapIfStale: true }); });
  window.addEventListener('focus', () => void kick());
  window.addEventListener('pageshow', () => void kick());
  interval = setInterval(() => {
    if (document.visibilityState === 'visible' && (queue.value.pending > 0 || net.value.lastNetworkErrorAt > net.value.lastSuccessAt)) void kick();
  }, 20_000);
  await refreshCounts();
}

export async function kick() {
  if (!worker) return;
  await refreshCounts();
  await worker.kick();
  await refreshCounts();
}

/** Flush the outbox and (optionally) refresh reference data. Never throws. */
export async function syncNow(opts: { bootstrap?: boolean; bootstrapIfStale?: boolean } = {}) {
  const b = deps?.backend();
  const userId = deps?.userId();
  if (!b || !userId) return;
  if (worker) worker.authPaused = false;
  authPaused.value = false;
  try { await b.auth.ensureFresh(); } catch { /* handled by outbox */ }
  await kick();
  const last = (await kvGet<number>('bootstrapAt')) ?? 0;
  if (opts.bootstrap || (opts.bootstrapIfStale && Date.now() - last > BOOTSTRAP_STALE_MS)) {
    try {
      await runBootstrap(b, userId, deps?.email() ?? '');
      net.value = { ...net.value, online: true, lastSuccessAt: Date.now() };
      deps?.onBootstrapped?.();
    } catch (e) {
      if (isNetworkError(e)) net.value = { ...net.value, lastNetworkErrorAt: Date.now() };
    }
  }
}

export function stopEngineForTests() { if (interval) clearInterval(interval); started = false; }
