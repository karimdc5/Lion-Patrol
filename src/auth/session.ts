import { signal, computed } from '@preact/signals';
import { db, kvGet, kvSet, kvDel, type IdentityRecord } from '../data/db';
import { createBackend, resolveMode, setMode, type BackendMode } from '../data/backend';
import type { Backend, StoredSession } from '../data/backend/types';
import { BackendError, isNetworkError } from '../data/backend/types';
import { runBootstrap } from '../data/sync/bootstrap';
import { startEngine, syncNow, kick } from '../data/sync/engine';
import { bumpData } from '../data/repos/records';
import type { Member, Role } from '../data/types';
import { uuidv7 } from '../lib/uuid';
import * as vault from './vault';
import { AUTO_LOCK_MS } from '../config';

export type Phase = 'booting' | 'signedOut' | 'locked' | 'ready';
export type UiMode = 'guard' | 'admin' | 'client';

export const phase = signal<Phase>('booting');
export const backendMode = signal<BackendMode>('supabase');
export const identity = signal<IdentityRecord | null>(null);
export const onlineAuth = signal(false);
export const currentOrgId = signal<string | null>(null);
export const uiMode = signal<UiMode>('guard');
export const lockTarget = signal<string | null>(null);
export const vaultEntries = signal<Awaited<ReturnType<typeof vault.list>>>([]);
/** Set after a fresh password login to offer "Remember this device". */
export const offerEnroll = signal(false);

let backend: Backend | null = null;
export function getBackend(): Backend {
  if (!backend) throw new Error('backend not ready');
  return backend;
}

export const membership = computed<Member | null>(() => {
  const id = identity.value;
  if (!id) return null;
  const ms = id.memberships as unknown as Member[];
  return ms.find((m) => m.org_id === currentOrgId.value) ?? ms[0] ?? null;
});
export const role = computed<Role | null>(() => membership.value?.role ?? null);
export const isStaff = computed(() => ['owner', 'admin', 'supervisor'].includes(role.value ?? ''));
export const isAdmin = computed(() => ['owner', 'admin'].includes(role.value ?? ''));
export const memberId = computed(() => membership.value?.id ?? null);
/** Name of the current org (from cache). */
export const orgName = signal('');

function defaultMode(r: Role | null): UiMode {
  if (r === 'client') return 'client';
  if (r === 'guard') return 'guard';
  return 'admin';
}

async function applyIdentity(ident: IdentityRecord) {
  identity.value = ident;
  void (async () => { const orgs = await (await db()).getAllFromIndex('records', 'byTable', 'patrol_orgs'); orgName.value = (orgs.find((o) => o.id === (ident.memberships as unknown as Member[])[0]?.org_id)?.data.name as string) ?? ''; })();
  const ms = ident.memberships as unknown as Member[];
  const lastOrg = await kvGet<string>(`org:${ident.userId}`);
  currentOrgId.value = ms.find((m) => m.org_id === lastOrg)?.org_id ?? ms[0]?.org_id ?? null;
  let savedMode: UiMode | undefined;
  try { savedMode = (localStorage.getItem(`lp-uimode:${ident.userId}`) as UiMode | null) ?? undefined; } catch { /* ignore */ }
  savedMode ??= await kvGet<UiMode>(`mode:${ident.userId}`);
  const r = (ms.find((m) => m.org_id === currentOrgId.value) ?? ms[0])?.role ?? null;
  const allowed: UiMode[] = r === 'client' ? ['client'] : r === 'guard' ? ['guard'] : ['admin', 'guard'];
  uiMode.value = savedMode && allowed.includes(savedMode) ? savedMode : defaultMode(r);
  await kvSet('lastUserId', ident.userId);
}

export async function setUiMode(m: UiMode) {
  uiMode.value = m;
  if (identity.value) {
    try { localStorage.setItem(`lp-uimode:${identity.value.userId}`, m); } catch { /* ignore */ }
    await kvSet(`mode:${identity.value.userId}`, m);
  }
}
export async function setOrg(orgId: string) {
  currentOrgId.value = orgId;
  if (identity.value) {
    await kvSet(`org:${identity.value.userId}`, orgId);
    await applyIdentity(identity.value);
  }
}

async function refreshVaultList() { vaultEntries.value = await vault.list(); }

/** Load identity from cache, then refresh it from the server in the background. */
async function loadIdentityFor(session: StoredSession): Promise<IdentityRecord | null> {
  const cached = await (await db()).get('identity', session.user.id);
  if (cached) return cached;
  try {
    await runBootstrap(getBackend(), session.user.id, session.user.email);
    return (await (await db()).get('identity', session.user.id)) ?? null;
  } catch (e) {
    if (isNetworkError(e)) return { userId: session.user.id, email: session.user.email, isAppAdmin: false, memberships: [], updatedAt: 0 };
    throw e;
  }
}

export async function boot() {
  const mode = resolveMode();
  backendMode.value = mode;
  backend = await createBackend(mode);
  try { await navigator.storage?.persist?.(); } catch { /* not granted */ }
  await startEngine({
    backend: () => backend,
    userId: () => (phase.value === 'ready' ? identity.value?.userId ?? null : null),
    email: () => identity.value?.email ?? '',
    onBootstrapped: async () => {
      const id = identity.value;
      if (id) {
        const fresh = await (await db()).get('identity', id.userId);
        if (fresh) identity.value = { ...fresh, email: fresh.email || id.email };
      }
      bumpData();
    },
  });

  backend.auth.onChange(async (event, s) => {
    if (event === 'TOKEN_REFRESHED' && s) await vault.rewrap(s.user.id, s);
    if (s) onlineAuth.value = true;
  });

  await refreshVaultList();
  const session = await backend.auth.getSession();
  if (session) {
    const ident = await loadIdentityFor(session).catch(() => null);
    if (ident) {
      await applyIdentity({ ...ident, email: ident.email || session.user.email });
      if ((await vault.isEnrolled(ident.userId)) && !vault.hasKey(ident.userId)) {
        lockTarget.value = ident.userId;
        phase.value = 'locked';
      } else {
        phase.value = 'ready';
      }
      void syncNow({ bootstrap: true });
      installAutoLock();
      return;
    }
  }
  phase.value = vaultEntries.value.length ? 'locked' : 'signedOut';
  installAutoLock();
}

async function finishLogin(session: StoredSession) {
  const b = getBackend();
  await runBootstrap(b, session.user.id, session.user.email);
  const ident = (await (await db()).get('identity', session.user.id))!;
  ident.email = session.user.email;
  await (await db()).put('identity', ident);
  await applyIdentity(ident);
  onlineAuth.value = true;
  phase.value = 'ready';
  offerEnroll.value = !(await vault.isEnrolled(session.user.id));
  void kick();
}

export async function signIn(email: string, password: string) {
  const s = await getBackend().auth.signIn(email.trim(), password);
  await finishLogin(s);
}

export async function signUp(email: string, password: string, displayName: string): Promise<'ok' | 'confirm'> {
  const s = await getBackend().auth.signUp(email.trim(), password, { display_name: displayName });
  if (!s) return 'confirm';
  await finishLogin(s);
  return 'ok';
}

export async function redeemInvite(code: string, displayName: string, phone?: string) {
  const res = await getBackend().rpc<{ ok: boolean; error?: string; org_id?: string }>('patrol_redeem_invite', {
    p_code: code, p_display_name: displayName, p_phone: phone ?? null,
  });
  if (!res.ok) throw new BackendError(res.error ?? 'invalid_invite', res.error === 'too_many_attempts'
    ? 'Too many attempts. Try again in an hour.'
    : res.error === 'use_separate_account'
      ? 'This is a client portal code. Your account already works for a security company, so sign up for the client portal with a different email to keep the two separate.'
      : res.error === 'member_disabled'
        ? 'Your access to this company is disabled. Ask the owner to restore it.'
        : 'That invite code is invalid, expired or already used.');
  const s = await getBackend().auth.getSession();
  if (s) await finishLogin(s);
  if (res.org_id) await setOrg(res.org_id);
}

export async function createOrg(name: string, displayName: string, timezone = 'America/Los_Angeles') {
  const orgId = uuidv7();
  await getBackend().rpc('patrol_create_org', { p_org_id: orgId, p_name: name, p_timezone: timezone, p_display_name: displayName });
  const s = await getBackend().auth.getSession();
  if (s) await finishLogin(s);
  await setOrg(orgId);
}

/** Item 14: change your own display name (the member row of the current company; RLS allows name/phone only). */
export async function updateMyName(name: string) {
  const id = identity.value, m = membership.value;
  if (!id || !m) throw new Error('Not signed in');
  const { enqueue } = await import('../data/outbox/queue');
  await enqueue({ userId: id.userId, orgId: m.org_id, kind: 'update', table: 'patrol_members', payload: { display_name: name }, match: { id: m.id }, entityKey: `patrol_members:${m.id}`, label: 'Update your name' },
    [{ table: 'patrol_members', row: { id: m.id, display_name: name } as unknown as import('../data/db').Row, orgId: m.org_id }]);
  const ident = { ...id, memberships: id.memberships.map((x) => (x.id === m.id ? { ...x, display_name: name } : x)) };
  await (await db()).put('identity', ident);
  identity.value = ident;
  bumpData();
  void kick();
}

export async function refreshIdentity() {
  const s = await getBackend().auth.getSession();
  if (s) await finishLogin(s);
}

// ---------- PIN / remembered devices ----------
export async function enrollPin(pin: string) {
  const id = identity.value;
  const s = await getBackend().auth.getSession();
  if (!id || !s) throw new Error('Not signed in');
  const m = membership.value;
  const orgs = await (await db()).getAllFromIndex('records', 'byTable', 'patrol_orgs');
  const orgName = (orgs.find((o) => o.id === m?.org_id)?.data.name as string) ?? '';
  await vault.enroll({ userId: id.userId, email: id.email, displayName: m?.display_name ?? id.email, orgName, role: m?.role ?? '' }, pin, s);
  offerEnroll.value = false;
  await refreshVaultList();
}

export async function lockNow() {
  const id = identity.value;
  if (!id || !(await vault.isEnrolled(id.userId))) return;
  const s = await getBackend().auth.getSession();
  if (s) await vault.rewrap(id.userId, s);
  vault.forgetKey(id.userId);
  lockTarget.value = id.userId;
  await refreshVaultList();
  phase.value = 'locked';
}

export async function unlockWithPin(userId: string, pin: string) {
  const res = await vault.unlock(userId, pin);
  if (!res.ok) { await refreshVaultList(); return res; }
  const b = getBackend();
  const current = await b.auth.getSession();
  if (!current || current.user.id !== userId) {
    // switching guards: park the current guard's latest tokens first
    if (current && (await vault.isEnrolled(current.user.id))) await vault.rewrap(current.user.id, current);
    await b.auth.adopt(res.session);
  }
  const session = (await b.auth.getSession()) ?? res.session;
  const ident = await loadIdentityFor(session);
  if (ident) await applyIdentity({ ...ident, email: ident.email || session.user.email });
  phase.value = 'ready';
  await refreshVaultList();
  void syncNow({ bootstrap: true });
  return res;
}

/** Go to the lock screen to let another remembered guard (or a new one) in. */
export async function switchGuard() {
  const id = identity.value;
  if (id) {
    await kick(); // try to flush this guard's work first
    const s = await getBackend().auth.getSession();
    if (s && (await vault.isEnrolled(id.userId))) await vault.rewrap(id.userId, s);
    vault.forgetKey(id.userId);
  }
  lockTarget.value = null;
  await refreshVaultList();
  phase.value = vaultEntries.value.length ? 'locked' : 'signedOut';
}

/** Sign out on this device. `forget` also removes the remembered PIN entry. */
export async function signOut(opts: { forget?: boolean; everywhere?: boolean } = {}) {
  const id = identity.value;
  if (id && opts.forget) await vault.remove(id.userId);
  else if (id) vault.forgetKey(id.userId);
  if (id && !opts.forget && (await vault.isEnrolled(id.userId))) {
    // keep tokens in the vault, only clear the active session locally
    const s = await getBackend().auth.getSession();
    if (s) await vault.rewrap(id.userId, s);
    await getBackend().auth.signOut('local');
  } else {
    await getBackend().auth.signOut(opts.everywhere ? 'global' : 'local');
  }
  await kvDel('lastUserId');
  identity.value = null;
  await refreshVaultList();
  lockTarget.value = null;
  phase.value = vaultEntries.value.length ? 'locked' : 'signedOut';
}

export async function startDemo(email: string) {
  if (backendMode.value !== 'demo') {
    setMode('demo');
    sessionStorage.setItem('lp-demo-autologin', email);
    location.reload();
    return;
  }
  const { DEMO_PASSWORD } = await import('../data/demo/seed');
  await signIn(email, DEMO_PASSWORD);
  offerEnroll.value = false;
}

export async function exitDemo() {
  setMode('supabase');
  location.href = location.pathname.replace(/\/[^/]*$/, '/').split('?')[0] ?? '/';
}

export async function resetDemo() {
  localStorage.removeItem('lp-demo-server');
  localStorage.removeItem('lp-auth-demo');
  indexedDB.deleteDatabase('lion-patrol-demo');
  location.reload();
}

// ---------- auto-lock ----------
let hiddenAt = 0;
let autoLockInstalled = false;
function installAutoLock() {
  if (autoLockInstalled) return;
  autoLockInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (phase.value === 'ready' && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) void lockNow();
  });
}
