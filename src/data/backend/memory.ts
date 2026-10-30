import { durableStorage } from '../../auth/storage-adapter';
import { uuidv7 } from '../../lib/uuid';
import seedCategories from '../../domain/categories.seed.json';
import { BackendError, type AuthApi, type AuthEvent, type Backend, type SelectQuery, type StoredSession } from './types';

/**
 * In-memory backend used for demo mode and end-to-end tests. "Server" state persists in
 * localStorage (so it survives reloads like a real server), honours navigator.onLine and a
 * fault-injection hook (window.__lpMock), and applies a mini version of the RLS rules.
 */
type R = Record<string, any> & { id: string };
export interface MockUser { id: string; email: string; password: string }
export interface MockState {
  users: MockUser[];
  appAdmins: string[];
  tables: Record<string, R[]>;
  objects: Record<string, { mime: string; size: number; head: string }>;
  counters: Record<string, number>;
}
export interface MockControl {
  offline: boolean;
  latencyMs: number;
  failQueue: Array<{ code: string; http?: number; message?: string; kind?: 'any' | 'upload' | 'write' }>;
  failNext(n: number, code: string, http?: number, kind?: 'any' | 'upload' | 'write'): void;
  calls: Array<{ op: string; table?: string; at: number }>;
}

const STAFF = ['owner', 'admin', 'supervisor'];
const ADMIN = ['owner', 'admin'];
const WORKER = ['owner', 'admin', 'supervisor', 'guard'];
const FIELD_TABLES = new Set(['patrol_time_entries', 'patrol_location_pings', 'patrol_tour_runs', 'patrol_scans', 'patrol_incidents', 'patrol_dars', 'patrol_dar_entries', 'patrol_attachments', 'patrol_alerts', 'patrol_consents']);
const ADMIN_TABLES = new Set(['patrol_sites', 'patrol_site_access', 'patrol_checkpoints', 'patrol_categories', 'patrol_subtypes', 'patrol_orgs', 'patrol_org_settings', 'patrol_invites']);
const STAFF_TABLES = new Set(['patrol_shifts']);

export function emptyState(): MockState {
  return { users: [], appAdmins: [], tables: {}, objects: {}, counters: {} };
}

function control(): MockControl {
  const w = globalThis as unknown as { __lpMock?: MockControl };
  if (!w.__lpMock) {
    const c: MockControl = {
      offline: false,
      latencyMs: 0,
      failQueue: [],
      calls: [],
      failNext(n, code, http, kind = 'any') { for (let i = 0; i < n; i++) this.failQueue.push({ code, http, kind }); },
    };
    w.__lpMock = c;
  }
  return w.__lpMock!;
}

export function createMemoryBackend(opts: { storageKey: string; authKey?: string; seed: () => MockState }): Backend {
  const AUTH_KEY = opts.authKey ?? 'lp-auth-mem';
  const load = (): MockState => {
    try {
      const raw = localStorage.getItem(opts.storageKey);
      if (raw) return JSON.parse(raw) as MockState;
    } catch { /* ignore */ }
    const s = opts.seed();
    save(s);
    return s;
  };
  const save = (s: MockState) => { try { localStorage.setItem(opts.storageKey, JSON.stringify(s)); } catch { /* quota */ } };
  const listeners = new Set<(e: AuthEvent, s: StoredSession | null) => void>();
  load(); // materialise the seeded "server" right away

  async function net(op: string, table?: string, kind: 'read' | 'write' | 'upload' = 'read') {
    const c = control();
    c.calls.push({ op, table, at: Date.now() });
    if (c.latencyMs) await new Promise((r) => setTimeout(r, c.latencyMs));
    const offline = c.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (offline) throw new BackendError('network', 'Network request failed (offline)', undefined, true);
    const idx = c.failQueue.findIndex((f) => f.kind === 'any' || f.kind === kind);
    if (idx >= 0) {
      const f = c.failQueue.splice(idx, 1)[0]!;
      if (f.code === 'network') throw new BackendError('network', 'Network request failed', undefined, true);
      throw new BackendError(f.code, f.message ?? `Injected failure ${f.code}`, f.http);
    }
  }

  async function currentSession(): Promise<StoredSession | null> {
    const raw = await durableStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }
  async function uid(): Promise<string | null> {
    return (await currentSession())?.user.id ?? null;
  }

  function ctx(s: MockState, userId: string | null) {
    const members = (s.tables.patrol_members ?? []).filter((m) => m.user_id === userId && m.status === 'active');
    const orgsWith = (roles: string[]) => members.filter((m) => roles.includes(m.role)).map((m) => m.org_id as string);
    const memberIds = members.map((m) => m.id);
    const access = (s.tables.patrol_site_access ?? []).filter((a) => memberIds.includes(a.member_id));
    const mySites = access.map((a) => a.site_id as string);
    const clientMemberIds = members.filter((m) => m.role === 'client').map((m) => m.id);
    const clientSites = access.filter((a) => clientMemberIds.includes(a.member_id)).map((a) => a.site_id as string);
    const staffOrgs = orgsWith(STAFF);
    const workerOrgs = orgsWith(WORKER);
    const workable = (s.tables.patrol_sites ?? [])
      .filter((x) => staffOrgs.includes(x.org_id) || (mySites.includes(x.id) && workerOrgs.includes(x.org_id)))
      .map((x) => x.id);
    return {
      userId, members, memberIds, mySites, clientSites, workable,
      memberOrgs: orgsWith(['owner', 'admin', 'supervisor', 'guard', 'client']),
      staffOrgs, adminOrgs: orgsWith(ADMIN), workerOrgs,
      memberIn: (org: string) => members.find((m) => m.org_id === org)?.id ?? null,
    };
  }
  type Ctx = ReturnType<typeof ctx>;

  function visible(s: MockState, c: Ctx, table: string, r: R): boolean {
    const mine = c.memberIds.includes(r.member_id);
    const staff = c.staffOrgs.includes(r.org_id);
    switch (table) {
      case 'patrol_orgs': return c.memberOrgs.includes(r.id);
      case 'patrol_org_settings': return staff;
      case 'patrol_members': return r.user_id === c.userId || staff;
      case 'patrol_sites': return staff || c.mySites.includes(r.id);
      case 'patrol_site_access': return staff || mine;
      case 'patrol_checkpoints': return staff || c.mySites.includes(r.site_id);
      case 'patrol_shifts': return staff || mine || (r.member_id == null && c.workable.includes(r.site_id));
      case 'patrol_time_entries': case 'patrol_member_status': case 'patrol_location_pings': case 'patrol_alerts': case 'patrol_consents':
        return staff || mine;
      case 'patrol_tour_runs': case 'patrol_scans': return staff || mine || c.clientSites.includes(r.site_id);
      case 'patrol_categories': case 'patrol_subtypes': return c.memberOrgs.includes(r.org_id);
      case 'patrol_incidents': return mine || (staff && r.status !== 'draft') || (c.clientSites.includes(r.site_id) && r.client_visible && r.status !== 'draft');
      case 'patrol_dars': return mine || (staff && r.status !== 'open') || (c.clientSites.includes(r.site_id) && r.client_visible);
      case 'patrol_dar_entries': {
        const dar = (s.tables.patrol_dars ?? []).find((d) => d.id === r.dar_id);
        return mine || (!!dar && visible(s, c, 'patrol_dars', dar));
      }
      case 'patrol_incident_events': {
        const inc = (s.tables.patrol_incidents ?? []).find((i) => i.id === r.incident_id);
        return staff || (!!inc && c.memberIds.includes(inc.member_id));
      }
      case 'patrol_attachments': {
        if (mine) return true;
        const parentTable = ({ incident: 'patrol_incidents', dar_entry: 'patrol_dar_entries', scan: 'patrol_scans', alert: 'patrol_alerts', site: 'patrol_sites', bolo: 'patrol_bolos', shift: 'patrol_time_entries' } as Record<string, string>)[r.parent_type];
        const parent = parentTable ? (s.tables[parentTable] ?? []).find((p) => p.id === r.parent_id) : undefined;
        if (r.parent_type === 'shift') return !!parent && c.staffOrgs.includes(parent.org_id);
        return !!parent && visible(s, c, parentTable!, parent);
      }
      case 'patrol_bolos': return staff || c.workable.includes(r.site_id);
      case 'patrol_owner_alerts': return c.adminOrgs.includes(r.org_id);
      case 'patrol_invites': return c.adminOrgs.includes(r.org_id);
      case 'patrol_share_links': case 'patrol_portal_links': return staff;
      default: return false;
    }
  }

  function canWrite(c: Ctx, table: string, r: R, op: 'insert' | 'update'): boolean {
    if (FIELD_TABLES.has(table)) {
      if (op === 'insert') {
        if (r.member_id !== c.memberIn(r.org_id)) return false;
        if (r.site_id && table !== 'patrol_attachments' && table !== 'patrol_alerts' && !c.workable.includes(r.site_id)) return false;
        return true;
      }
      return c.memberIds.includes(r.member_id) || (table === 'patrol_time_entries' && c.staffOrgs.includes(r.org_id));
    }
    if (table === 'patrol_bolos') {
      if (op === 'insert') return r.created_by === c.memberIn(r.org_id) && c.workerOrgs.includes(r.org_id) && c.workable.includes(r.site_id);
      return c.staffOrgs.includes(r.org_id) || c.memberIds.includes(r.created_by);
    }
    if (table === 'patrol_owner_alerts') return op === 'update' && c.adminOrgs.includes(r.org_id);
    if (ADMIN_TABLES.has(table)) return c.adminOrgs.includes(r.org_id ?? r.id);
    if (STAFF_TABLES.has(table)) return c.staffOrgs.includes(r.org_id);
    if (table === 'patrol_members' && op === 'update') return c.adminOrgs.includes(r.org_id) || r.user_id === c.userId;
    return false;
  }

  function nowIso() { return new Date().toISOString(); }

  /** Server-side trigger equivalents. */
  function beforeWrite(s: MockState, table: string, row: R, prev: R | undefined): R | null {
    const t = { ...row };
    const memberName = (id: string) => (s.tables.patrol_members ?? []).find((m) => m.id === id)?.display_name ?? '';
    if (!prev) {
      t.created_at ??= nowIso();
      if (table === 'patrol_incidents' || table === 'patrol_dars') {
        t.author_name = memberName(t.member_id);
        t.client_visible = false; t.report_no = null;
        t.client_rev ??= 0;
      }
      if (table === 'patrol_alerts') t.member_name = memberName(t.member_id);
      if (table === 'patrol_attachments') t.upload_status = 'pending';
      if (table === 'patrol_time_entries') {
        const m = (s.tables.patrol_members ?? []).find((x) => x.id === t.member_id);
        const site = (s.tables.patrol_sites ?? []).find((x) => x.id === t.site_id);
        if (m?.role === 'guard' && site?.lat != null && site.lng != null) {
          if (t.clock_in_lat == null) throw new BackendError('23514', 'clock_in_gps_required', 400);
          if (haversine(t.clock_in_lat, t.clock_in_lng, site.lat, site.lng) > site.geofence_m + Math.min(t.clock_in_accuracy_m ?? 0, 100)) throw new BackendError('23514', 'outside_geofence', 400);
        }
      }
      if (table === 'patrol_bolos') { t.status = 'active'; t.resolved_at = null; t.visible_to_client ??= false; }
    } else {
      if (table === 'patrol_bolos') {
        t.org_id = prev.org_id; t.site_id = prev.site_id; t.created_by = prev.created_by;
        if (t.status === 'resolved' && prev.status !== 'resolved') t.resolved_at = nowIso(); else if (t.status === 'active') t.resolved_at = null;
      }
      if ((table === 'patrol_incidents' || table === 'patrol_dars') && typeof t.client_rev === 'number') {
        const editable = table === 'patrol_incidents' ? prev.status === 'draft' : prev.status === 'open';
        if (t.client_rev <= (prev.client_rev ?? 0)) return null; // stale replay
        if (!editable) throw new BackendError('P0001', 'not_editable', 400);
      }
    }
    t.updated_at = nowIso();
    const merged = { ...(prev ?? {}), ...t };
    const submitting = (table === 'patrol_incidents' || table === 'patrol_dars') && merged.status === 'submitted' && (!prev || prev.status === 'draft' || prev.status === 'open');
    if (submitting) {
      s.counters[merged.org_id] = (s.counters[merged.org_id] ?? 0) + 1;
      const site = (s.tables.patrol_sites ?? []).find((x) => x.id === merged.site_id);
      const settings = (s.tables.patrol_org_settings ?? []).find((x) => x.org_id === merged.org_id);
      const code = String(site?.code ?? 'SITE').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SITE';
      merged.report_no = `${settings?.report_prefix ?? 'LSS'}-${code}-${new Date().getFullYear()}-${String(s.counters[merged.org_id]).padStart(5, '0')}`;
      merged.submitted_at = nowIso();
      merged.client_visible = !!settings?.auto_share_with_client;
      if (table === 'patrol_incidents') {
        merged.category_name = (s.tables.patrol_categories ?? []).find((x) => x.id === merged.category_id)?.name ?? null;
        merged.subtype_name = (s.tables.patrol_subtypes ?? []).find((x) => x.id === merged.subtype_id)?.name ?? null;
      }
    }
    return merged;
  }

  function afterWrite(s: MockState, table: string, row: R) {
    const st = (s.tables.patrol_member_status ??= []);
    if (table === 'patrol_time_entries') {
      const existing = st.find((x) => x.member_id === row.member_id);
      const status = row.clock_out_at
        ? { ...(existing ?? {}), on_duty: false, time_entry_id: null }
        : { member_id: row.member_id, org_id: row.org_id, on_duty: true, time_entry_id: row.id, site_id: row.site_id, lat: row.clock_in_lat, lng: row.clock_in_lng, last_ping_at: row.clock_in_lat != null ? row.clock_in_at : existing?.last_ping_at ?? null, on_duty_since: row.clock_in_at };
      const next = { ...(existing ?? {}), ...status, id: row.member_id, updated_at: nowIso() } as R;
      if (existing) Object.assign(existing, next); else st.push(next);
    }
    if (table === 'patrol_location_pings') {
      const existing = st.find((x) => x.member_id === row.member_id && x.time_entry_id === row.time_entry_id);
      if (existing && (!existing.last_ping_at || existing.last_ping_at < row.recorded_at)) {
        Object.assign(existing, { lat: row.lat, lng: row.lng, accuracy_m: row.accuracy_m, last_ping_at: row.recorded_at, updated_at: nowIso() });
      }
    }
    if ((table === 'patrol_scans' || table === 'patrol_dar_entries') && row.lat != null) {
      const te = table === 'patrol_scans' ? row.time_entry_id : (s.tables.patrol_dars ?? []).find((d) => d.id === row.dar_id)?.time_entry_id;
      const at = table === 'patrol_scans' ? row.scanned_at : row.occurred_at;
      const existing = st.find((x) => x.member_id === row.member_id && x.on_duty && x.time_entry_id === te);
      if (existing && (!existing.last_ping_at || existing.last_ping_at < at)) Object.assign(existing, { lat: row.lat, lng: row.lng, last_ping_at: at, updated_at: nowIso() });
    }
    if (table === 'patrol_scans' && row.tour_run_id && !(row.flags ?? []).includes('duplicate')) {
      const run = (s.tables.patrol_tour_runs ?? []).find((x) => x.id === row.tour_run_id);
      if (run) {
        run.scanned_count = (run.scanned_count ?? 0) + 1;
        if (!run.completed_at && run.expected_count > 0 && run.scanned_count >= run.expected_count) run.completed_at = row.scanned_at;
        run.updated_at = nowIso();
      }
    }
  }

  function applyQuery(rows: R[], q: SelectQuery): R[] {
    let out = rows;
    for (const [k, v] of Object.entries(q.eq ?? {})) out = out.filter((r) => (v === null ? r[k] == null : r[k] === v));
    for (const [k, v] of Object.entries(q.in ?? {})) out = out.filter((r) => v.includes(r[k]));
    for (const [k, v] of Object.entries(q.gt ?? {})) out = out.filter((r) => r[k] > v);
    for (const [k, v] of Object.entries(q.gte ?? {})) out = out.filter((r) => r[k] >= v);
    if (q.order) {
      const [col, dir] = q.order;
      out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'asc' ? 1 : -1));
    }
    if (q.limit) out = out.slice(0, q.limit);
    return out;
  }

  const emit = (e: AuthEvent, sess: StoredSession | null) => listeners.forEach((l) => l(e, sess));

  function makeSession(user: MockUser): StoredSession {
    return {
      access_token: `mock.${user.id}.${uuidv7()}`,
      refresh_token: `mockr.${uuidv7()}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
      token_type: 'bearer',
      user: { id: user.id, email: user.email },
    };
  }

  const auth: AuthApi = {
    async getSession() { return currentSession(); },
    async signIn(email, password) {
      await net('auth.signIn');
      const s = load();
      const u = s.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u || u.password !== password) throw new BackendError('invalid_credentials', 'Invalid login credentials', 400);
      const sess = makeSession(u);
      await durableStorage.setItem(AUTH_KEY, JSON.stringify(sess));
      emit('SIGNED_IN', sess);
      return sess;
    },
    async signUp(email, password) {
      await net('auth.signUp');
      const s = load();
      const e = email.trim().toLowerCase();
      if (s.users.some((x) => x.email === e)) throw new BackendError('user_already_exists', 'User already registered', 422);
      if (password.length < 8) throw new BackendError('weak_password', 'Password should be at least 8 characters.', 422);
      const u: MockUser = { id: uuidv7(), email: e, password };
      s.users.push(u);
      save(s);
      const sess = makeSession(u);
      await durableStorage.setItem(AUTH_KEY, JSON.stringify(sess));
      emit('SIGNED_IN', sess);
      return sess;
    },
    async signOut() {
      await durableStorage.removeItem(AUTH_KEY);
      emit('SIGNED_OUT', null);
    },
    async adopt(session) {
      await durableStorage.setItem(AUTH_KEY, JSON.stringify(session));
      emit('SIGNED_IN', session);
    },
    async ensureFresh() { return currentSession(); },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };

  async function requireUser(): Promise<string> {
    const u = await uid();
    if (!u) throw new BackendError('PGRST301', 'JWT expired', 401);
    return u;
  }

  const rpcs: Record<string, (s: MockState, c: Ctx, a: Record<string, any>) => unknown> = {
    patrol_bootstrap(s, c) {
      const vis = (t: string) => (s.tables[t] ?? []).filter((r) => visible(s, c, t, r));
      const now = Date.now();
      return {
        user_id: c.userId,
        is_app_admin: s.appAdmins.includes(c.userId!),
        server_time: nowIso(),
        memberships: c.members,
        orgs: vis('patrol_orgs'),
        settings: vis('patrol_org_settings'),
        public_settings: (s.tables.patrol_org_settings ?? []).filter((x) => c.memberOrgs.includes(x.org_id)).map((x) => ({ org_id: x.org_id, gps_ping_interval_s: x.gps_ping_interval_s, max_video_mb: x.max_video_mb, max_video_s: x.max_video_s, tour_interval_min: x.tour_interval_min, tour_max_duration_min: x.tour_max_duration_min, report_prefix: x.report_prefix })),
        members: vis('patrol_members'),
        sites: vis('patrol_sites'),
        site_access: vis('patrol_site_access'),
        checkpoints: vis('patrol_checkpoints'),
        categories: vis('patrol_categories').sort((a, b) => a.sort - b.sort),
        subtypes: vis('patrol_subtypes'),
        shifts: vis('patrol_shifts').filter((x) => Date.parse(x.ends_at) > now - 864e5 && Date.parse(x.starts_at) < now + 14 * 864e5),
        open_time_entries: vis('patrol_time_entries').filter((x) => c.memberIds.includes(x.member_id) && !x.clock_out_at),
        open_dars: vis('patrol_dars').filter((x) => c.memberIds.includes(x.member_id) && x.status === 'open'),
        open_tour_runs: vis('patrol_tour_runs').filter((x) => c.memberIds.includes(x.member_id) && !x.completed_at),
        consents: vis('patrol_consents').filter((x) => c.memberIds.includes(x.member_id)),
        member_status: vis('patrol_member_status'),
      };
    },
    patrol_create_org(s, c, a) {
      if (!s.appAdmins.includes(c.userId!)) throw new BackendError('42501', 'not_app_admin', 403);
      const id = a.p_org_id ?? uuidv7();
      if ((s.tables.patrol_orgs ?? []).some((o) => o.id === id)) return id;
      const email = s.users.find((u) => u.id === c.userId)?.email ?? '';
      (s.tables.patrol_orgs ??= []).push({ id, name: a.p_name, timezone: a.p_timezone ?? 'America/Los_Angeles', email, created_by: c.userId, created_at: nowIso(), updated_at: nowIso() });
      (s.tables.patrol_org_settings ??= []).push(defaultSettings(id, [email]));
      (s.tables.patrol_members ??= []).push({ id: uuidv7(), org_id: id, user_id: c.userId, role: 'owner', status: 'active', display_name: a.p_display_name || email.split('@')[0], email, created_at: nowIso(), updated_at: nowIso() });
      seedCats(s, id);
      return id;
    },
    patrol_seed_categories(s, c, a) {
      if (!c.adminOrgs.includes(a.p_org)) throw new BackendError('42501', 'not_admin', 403);
      return seedCats(s, a.p_org);
    },
    patrol_reorder_categories(s, c, a) {
      if (!c.adminOrgs.includes(a.p_org)) throw new BackendError('42501', 'not_admin', 403);
      (a.p_ids as string[]).forEach((id, i) => { const x = (s.tables.patrol_categories ?? []).find((r) => r.id === id && r.org_id === a.p_org); if (x) { x.sort = i; x.updated_at = nowIso(); } });
      return null;
    },
    patrol_reorder_subtypes(s, c, a) {
      (a.p_ids as string[]).forEach((id, i) => { const x = (s.tables.patrol_subtypes ?? []).find((r) => r.id === id); if (x && c.adminOrgs.includes(x.org_id)) { x.sort = i; x.updated_at = nowIso(); } });
      return null;
    },
    patrol_create_invite(s, c, a) {
      if (!c.adminOrgs.includes(a.p_org)) throw new BackendError('42501', 'not_admin', 403);
      if (a.p_role === 'owner') throw new BackendError('42501', 'owner_invite_not_allowed', 403);
      if (a.p_role === 'client' && !(a.p_site_ids ?? []).length) throw new BackendError('22023', 'client_requires_site', 400);
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const code = Array.from(bytes, (b) => alphabet[b % 32]).join('');
      const id = uuidv7();
      (s.tables.patrol_invites ??= []).push({ id, org_id: a.p_org, code_plain: code, code_hint: code.slice(4), role: a.p_role, site_ids: a.p_site_ids ?? [], email: a.p_email ?? null, display_name: a.p_display_name ?? null, max_uses: a.p_max_uses ?? 1, uses: 0, expires_at: new Date(Date.now() + (a.p_ttl_hours ?? 168) * 3600e3).toISOString(), revoked_at: null, created_by: c.memberIn(a.p_org), created_at: nowIso(), updated_at: nowIso() });
      return { invite_id: id, code: `LION-${code.slice(0, 4)}-${code.slice(4)}` };
    },
    patrol_redeem_invite(s, c, a) {
      const norm = String(a.p_code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^LION(?=.{8}$)/, '').replace(/O/g, '0').replace(/[IL]/g, '1');
      const inv = (s.tables.patrol_invites ?? []).find((i) => i.code_plain === norm);
      const email = s.users.find((u) => u.id === c.userId)?.email ?? '';
      if (!inv || inv.revoked_at || Date.parse(inv.expires_at) < Date.now() || inv.uses >= inv.max_uses || (inv.email && inv.email !== email)) {
        return { ok: false, error: 'invalid_invite' };
      }
      // Client codes never attach to an account that already works for a company (separate identities).
      if (inv.role === 'client' && (s.tables.patrol_members ?? []).some((x) => x.user_id === c.userId && x.role !== 'client')) return { ok: false, error: 'use_separate_account' };
      let m = (s.tables.patrol_members ?? []).find((x) => x.org_id === inv.org_id && x.user_id === c.userId);
      if (m && m.status !== 'active') return { ok: false, error: 'member_disabled' };
      // Existing members: name/role/phone are never touched.
      if (!m) {
        m = { id: uuidv7(), org_id: inv.org_id, user_id: c.userId, role: inv.role, status: 'active', display_name: a.p_display_name || inv.display_name || email.split('@')[0], email, phone: a.p_phone ?? null, created_at: nowIso(), updated_at: nowIso() };
        (s.tables.patrol_members ??= []).push(m);
      }
      for (const site of inv.site_ids) {
        if (!(s.tables.patrol_site_access ?? []).some((x) => x.site_id === site && x.member_id === m!.id)) {
          (s.tables.patrol_site_access ??= []).push({ id: `${site}:${m.id}`, org_id: inv.org_id, site_id: site, member_id: m.id, created_at: nowIso() });
        }
      }
      inv.uses++;
      return { ok: true, org_id: inv.org_id, member_id: m.id, role: m.role };
    },
    patrol_set_incident_status(s, c, a) {
      const inc = (s.tables.patrol_incidents ?? []).find((x) => x.id === a.p_id);
      if (!inc || !c.staffOrgs.includes(inc.org_id) || inc.status === 'draft') throw new BackendError('42501', 'not_found', 403);
      inc.status = a.p_status;
      if (a.p_severity) inc.severity = a.p_severity;
      if (['reviewed', 'sent_to_client', 'closed'].includes(a.p_status)) { inc.reviewed_by ??= c.memberIn(inc.org_id); inc.reviewed_at ??= nowIso(); }
      if (a.p_status === 'sent_to_client') { inc.client_visible = true; inc.sent_to_client_at ??= nowIso(); }
      inc.updated_at = nowIso();
      (s.tables.patrol_incident_events ??= []).push({ id: uuidv7(), org_id: inc.org_id, incident_id: inc.id, actor_id: c.memberIn(inc.org_id), actor_name: c.members.find((m) => m.org_id === inc.org_id)?.display_name ?? '', kind: 'status', to_status: a.p_status, body: a.p_note ?? null, created_at: nowIso() });
      return inc;
    },
    patrol_set_incident_client_visible(s, c, a) {
      const inc = (s.tables.patrol_incidents ?? []).find((x) => x.id === a.p_id);
      if (!inc || !c.staffOrgs.includes(inc.org_id) || inc.status === 'draft') throw new BackendError('42501', 'not_found', 403);
      inc.client_visible = !!a.p_visible; if (a.p_visible) inc.sent_to_client_at ??= nowIso(); inc.updated_at = nowIso();
      return null;
    },
    patrol_add_incident_note(s, c, a) {
      const inc = (s.tables.patrol_incidents ?? []).find((x) => x.id === a.p_id);
      if (!inc || inc.status === 'draft') throw new BackendError('42501', 'not_found', 403);
      const staff = c.staffOrgs.includes(inc.org_id);
      const internal = a.p_internal !== false && staff;
      (s.tables.patrol_incident_events ??= []).push({ id: uuidv7(), org_id: inc.org_id, incident_id: inc.id, actor_id: c.memberIn(inc.org_id), actor_name: c.members.find((m) => m.org_id === inc.org_id)?.display_name ?? '', kind: internal ? 'note' : 'addendum', body: a.p_body, created_at: nowIso() });
      if (internal) { inc.review_notes = [inc.review_notes, a.p_body].filter(Boolean).join('\n'); inc.updated_at = nowIso(); }
      return null;
    },
    patrol_set_dar_status(s, c, a) {
      const d = (s.tables.patrol_dars ?? []).find((x) => x.id === a.p_id);
      if (!d || !c.staffOrgs.includes(d.org_id) || d.status === 'open') throw new BackendError('42501', 'not_found', 403);
      d.status = a.p_status; d.reviewed_at ??= nowIso();
      if (a.p_status === 'sent_to_client') { d.client_visible = true; d.sent_to_client_at ??= nowIso(); }
      d.updated_at = nowIso();
      return d;
    },
    patrol_create_portal_link(s, c, a) {
      const site = (s.tables.patrol_sites ?? []).find((x) => x.id === a.p_site);
      if (!site || !c.staffOrgs.includes(site.org_id)) throw new BackendError('42501', 'not_found', 403);
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
      const id = uuidv7();
      const exp = a.p_days ? new Date(Date.now() + a.p_days * 864e5).toISOString() : null;
      (s.tables.patrol_portal_links ??= []).push({ id, org_id: site.org_id, site_id: site.id, token_plain: token, label: a.p_label ?? null, expires_at: exp, revoked_at: null, view_count: 0, created_by: c.memberIn(site.org_id), created_at: nowIso() });
      return { id, token, expires_at: exp };
    },
    patrol_revoke_portal_link(s, c, a) {
      const l = (s.tables.patrol_portal_links ?? []).find((x) => x.id === a.p_id);
      if (!l || !c.staffOrgs.includes(l.org_id)) throw new BackendError('42501', 'not_found', 403);
      l.revoked_at ??= nowIso();
      return null;
    },
    patrol_get_portal(s, _c, a) {
      const l = (s.tables.patrol_portal_links ?? []).find((x) => x.token_plain === a.p_token && !x.revoked_at && (!x.expires_at || Date.parse(x.expires_at) > Date.now()));
      if (!l) return null;
      l.view_count++;
      const o = (s.tables.patrol_orgs ?? []).find((x) => x.id === l.org_id)!;
      const site = (s.tables.patrol_sites ?? []).find((x) => x.id === l.site_id)!;
      const strip = ({ review_notes: _r, reviewed_by: _b, client_rev: _c2, device_id: _d, notified_at: _n, deleted_at: _x, ...rest }: R) => rest;
      return {
        expires_at: l.expires_at,
        org: { name: o.name, phone: o.phone, email: o.email, license_no: o.license_no },
        site: { id: site.id, name: site.name, address: site.address, city: site.city, state: site.state },
        incidents: (s.tables.patrol_incidents ?? []).filter((i) => i.site_id === l.site_id && i.client_visible && i.status !== 'draft').sort((x, y) => y.occurred_at.localeCompare(x.occurred_at))
          .map((i) => ({ ...strip(i), field_config: (s.tables.patrol_categories ?? []).find((x) => x.id === i.category_id)?.field_config ?? null })),
        dars: (s.tables.patrol_dars ?? []).filter((d) => d.site_id === l.site_id && d.client_visible).sort((x, y) => String(y.report_date).localeCompare(String(x.report_date))).map((d) => ({
          id: d.id, report_no: d.report_no, report_date: d.report_date, author_name: d.author_name, summary: d.summary, status: d.status,
          entries: (s.tables.patrol_dar_entries ?? []).filter((e) => e.dar_id === d.id && !e.deleted_at).sort((x, y) => x.occurred_at.localeCompare(y.occurred_at)).map((e) => ({ occurred_at: e.occurred_at, category_name: e.category_name, body: e.body })),
          tours: (s.tables.patrol_tour_runs ?? []).filter((r) => d.time_entry_id && r.time_entry_id === d.time_entry_id).map((r) => ({ started_at: r.started_at, completed_at: r.completed_at, expected_count: r.expected_count, scanned_count: r.scanned_count })),
        })),
        bolos: (s.tables.patrol_bolos ?? []).filter((b) => b.site_id === l.site_id && b.visible_to_client && b.status === 'active' && (!b.expires_at || Date.parse(b.expires_at) > Date.now()))
          .sort((x, y) => y.created_at.localeCompare(x.created_at))
          .map((b) => ({ id: b.id, title: b.title, description: b.description, person_desc: b.person_desc, vehicle_desc: b.vehicle_desc, expires_at: b.expires_at, created_at: b.created_at, photos: bolosPhotos(s, b.id) })),
        runs: (s.tables.patrol_tour_runs ?? []).filter((r) => r.site_id === l.site_id && Date.parse(r.started_at) > Date.now() - 14 * 864e5).map((r) => ({ started_at: r.started_at, expected_count: r.expected_count, scanned_count: r.scanned_count, completed_at: r.completed_at })),
      };
    },
    patrol_notify_targets(s, c, a) {
      if (!c.workerOrgs.includes(a.p_org)) return null;
      const st = (s.tables.patrol_org_settings ?? []).find((x) => x.org_id === a.p_org);
      if (!st) return null;
      const members = (s.tables.patrol_members ?? []).filter((m) => m.org_id === a.p_org);
      const owners = new Set(members.filter((m) => m.status === 'active' && ['owner', 'admin'].includes(m.role)).map((m) => String(m.email).toLowerCase()));
      const clients = new Set(members.filter((m) => m.role === 'client').map((m) => String(m.email).toLowerCase()));
      const ownersOnly = st.email_owners_only !== false;
      const recipients = Array.from(new Set((st.notify_emails as string[]).map((e) => e.toLowerCase()))).filter((e) => owners.has(e) || (!ownersOnly && !clients.has(e)));
      return { enabled: !!st.email_enabled, min_severity: st.email_min_severity ?? 'medium', owners_only: ownersOnly, recipients };
    },
    patrol_alert_set_status(s, c, a) {
      const al = (s.tables.patrol_alerts ?? []).find((x) => x.id === a.p_id);
      if (!al) throw new BackendError('42501', 'not_found', 403);
      const staff = c.staffOrgs.includes(al.org_id);
      if (a.p_status === 'cancelled' && (c.memberIds.includes(al.member_id) || staff)) { al.status = 'cancelled'; al.cancelled_at ??= nowIso(); }
      else if (['acknowledged', 'resolved'].includes(a.p_status) && staff) { al.status = a.p_status; al.acknowledged_at ??= nowIso(); if (a.p_status === 'resolved') al.resolved_at = nowIso(); }
      else throw new BackendError('42501', 'not_allowed', 403);
      al.updated_at = nowIso();
      return al;
    },
    patrol_mark_notified(s, _c, a) {
      const row = (s.tables[a.p_table] ?? []).find((x) => x.id === a.p_id);
      if (row) row.notified_at ??= nowIso();
      return null;
    },
    patrol_check_owner_alerts(s, c, a) {
      if (!c.workerOrgs.includes(a.p_org)) return { created: 0 };
      const alerts = (s.tables.patrol_owner_alerts ??= []);
      const now = Date.now();
      let created = 0;
      const add = (key: string, row: Record<string, unknown>) => { if (alerts.some((x) => x.org_id === a.p_org && x.dedupe_key === key)) return; alerts.push({ ...row, id: uuidv7(), org_id: a.p_org, dedupe_key: key, acknowledged_at: null, created_at: nowIso(), updated_at: nowIso() }); created++; };
      const st = (s.tables.patrol_org_settings ?? []).find((x) => x.org_id === a.p_org);
      const name = (id: string) => (s.tables.patrol_members ?? []).find((m) => m.id === id)?.display_name ?? 'Guard';
      const siteOf = (id: string) => (s.tables.patrol_sites ?? []).find((x) => x.id === id);
      for (const r of (s.tables.patrol_tour_runs ?? []).filter((x) => x.org_id === a.p_org && !x.completed_at && x.expected_count > 0 && (x.scanned_count ?? 0) < x.expected_count && Date.parse(x.started_at) > now - 2 * 864e5)) {
        const site = siteOf(r.site_id);
        const max = site?.tour_max_duration_min ?? st?.tour_max_duration_min ?? 30;
        if (Date.parse(r.started_at) + max * 60e3 < now) add(`missed:${r.id}`, { kind: 'missed_checkpoint', site_id: r.site_id, member_id: r.member_id, tour_run_id: r.id, time_entry_id: r.time_entry_id, title: `Missed checkpoints at ${site?.name ?? 'site'}`, body: `${name(r.member_id)} scanned ${r.scanned_count ?? 0} of ${r.expected_count} checkpoints.` });
      }
      for (const sh of (s.tables.patrol_shifts ?? []).filter((x) => x.org_id === a.p_org && x.member_id && !x.cancelled_at && Date.parse(x.starts_at) + 10 * 60e3 < now && Date.parse(x.ends_at) > now)) {
        const came = (s.tables.patrol_time_entries ?? []).some((t) => t.member_id === sh.member_id && Date.parse(t.clock_in_at) > Date.parse(sh.starts_at) - 2 * 3600e3 && Date.parse(t.clock_in_at) < Date.parse(sh.ends_at));
        if (!came) add(`noshow:${sh.id}`, { kind: 'no_show', site_id: sh.site_id, member_id: sh.member_id, shift_id: sh.id, title: `No-show at ${siteOf(sh.site_id)?.name ?? 'site'}`, body: `${name(sh.member_id)} has not clocked in for the shift that started ${new Date(sh.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` });
      }
      return { created };
    },
    patrol_report_geofence_block(s, c, a) {
      const site = (s.tables.patrol_sites ?? []).find((x) => x.id === a.p_site);
      if (!site || !c.workable.includes(site.id)) return null;
      const mid = c.memberIn(site.org_id);
      const d = a.p_lat == null || site.lat == null ? null : Math.round(haversine(a.p_lat, a.p_lng, site.lat, site.lng));
      const key = `geofence:${mid}:${new Date().toISOString().slice(0, 16)}`;
      const alerts = (s.tables.patrol_owner_alerts ??= []);
      if (!alerts.some((x) => x.dedupe_key === key)) alerts.push({ id: uuidv7(), org_id: site.org_id, kind: 'geofence', dedupe_key: key, site_id: site.id, member_id: mid, title: `Clock-in blocked outside ${site.name}`, body: `${c.members.find((m) => m.id === mid)?.display_name ?? 'A guard'} tried to clock in ${d != null ? `${d} m from the site` : 'without a GPS fix'}.`, lat: a.p_lat ?? null, lng: a.p_lng ?? null, acknowledged_at: null, created_at: nowIso(), updated_at: nowIso() });
      return null;
    },
    patrol_add_shift_by_names(s, c, a) {
      if (!c.staffOrgs.includes(a.p_org)) throw new BackendError('42501', 'not_staff', 403);
      const q = String(a.p_site).trim().toLowerCase();
      const sites = (s.tables.patrol_sites ?? []).filter((x) => x.org_id === a.p_org && x.active !== false && (String(x.code ?? '').toLowerCase() === q || x.name.toLowerCase() === q || x.name.toLowerCase().includes(q)));
      if (sites.length !== 1) throw new BackendError('22023', `site_not_unique: ${sites.length} matches`, 400);
      const g = String(a.p_guard ?? '').trim().toLowerCase();
      const ms = g && !['open', 'unassigned'].includes(g) ? (s.tables.patrol_members ?? []).filter((m) => m.org_id === a.p_org && m.status === 'active' && m.role !== 'client' && (m.display_name.toLowerCase() === g || String(m.email).toLowerCase() === g || m.display_name.toLowerCase().startsWith(g))) : [];
      if (g && !['open', 'unassigned'].includes(g) && ms.length !== 1) throw new BackendError('22023', `guard_not_unique: ${ms.length} matches`, 400);
      const row = { id: uuidv7(), org_id: a.p_org, site_id: sites[0]!.id, member_id: ms[0]?.id ?? null, starts_at: a.p_starts_at, ends_at: a.p_ends_at, notes: a.p_notes ?? null, cancelled_at: null, created_by: c.memberIn(a.p_org), created_at: nowIso(), updated_at: nowIso() };
      (s.tables.patrol_shifts ??= []).push(row);
      return { shift_id: row.id, site_id: row.site_id, member_id: row.member_id, starts_at: row.starts_at, ends_at: row.ends_at };
    },
    patrol_client_bolos(s, c) {
      return (s.tables.patrol_bolos ?? []).filter((b) => c.clientSites.includes(b.site_id) && b.visible_to_client && b.status === 'active' && (!b.expires_at || Date.parse(b.expires_at) > Date.now()))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((b) => ({ id: b.id, site_id: b.site_id, title: b.title, description: b.description, person_desc: b.person_desc, vehicle_desc: b.vehicle_desc, expires_at: b.expires_at, created_at: b.created_at, photos: bolosPhotos(s, b.id) }));
    },
    patrol_storage_usage(s, c, a) {
      if (!c.staffOrgs.includes(a.p_org)) return null;
      const atts = (s.tables.patrol_attachments ?? []).filter((x) => x.org_id === a.p_org);
      return { total_bytes: atts.reduce((n, x) => n + (x.size_bytes ?? 0), 0), by_kind: {} };
    },
  };

  function seedCats(s: MockState, org: string): number {
    let added = 0;
    const cats = (s.tables.patrol_categories ??= []);
    const subs = (s.tables.patrol_subtypes ??= []);
    const max = Math.max(-1, ...cats.filter((c) => c.org_id === org).map((c) => c.sort));
    (seedCategories as Array<{ name: string; color: string; icon: string; use_for: string; default_severity: string; required_fields: string[]; field_config: unknown; subtypes: string[] }>).forEach((sc, i) => {
      let cat = cats.find((c) => c.org_id === org && c.name.toLowerCase() === sc.name.toLowerCase());
      if (!cat) {
        cat = { id: uuidv7(), org_id: org, name: sc.name, color: sc.color, icon: sc.icon, sort: max + 1 + i, hidden: false, required_fields: sc.required_fields, default_severity: sc.default_severity, use_for: sc.use_for, field_config: sc.field_config, created_at: nowIso(), updated_at: nowIso() };
        cats.push(cat);
        added++;
      }
      sc.subtypes.forEach((name, j) => {
        if (!subs.some((x) => x.category_id === cat!.id && x.name.toLowerCase() === name.toLowerCase())) {
          subs.push({ id: uuidv7(), org_id: org, category_id: cat!.id, name, sort: j, hidden: false, created_at: nowIso(), updated_at: nowIso() });
        }
      });
    });
    return added;
  }

  return {
    kind: 'memory',
    auth,
    async select<T>(table: string, q: SelectQuery = {}) {
      await net('select', table);
      const userId = await requireUser();
      const s = load();
      const c = ctx(s, userId);
      return applyQuery((s.tables[table] ?? []).filter((r) => visible(s, c, table, r)), q) as unknown as T[];
    },
    async insert(table, rows, opts) {
      await net('insert', table, 'write');
      const userId = await requireUser();
      const s = load();
      const c = ctx(s, userId);
      const list = (s.tables[table] ??= []);
      for (const raw of rows as R[]) {
        const row = { ...raw, id: raw.id ?? (table === 'patrol_site_access' ? `${raw.site_id}:${raw.member_id}` : uuidv7()) };
        const existing = list.find((r) => r.id === row.id);
        if (existing) {
          if (opts?.ignoreDuplicates) continue;
          throw new BackendError('23505', 'duplicate key value violates unique constraint', 409);
        }
        if (!canWrite(c, table, row, 'insert')) throw new BackendError('42501', `new row violates row-level security policy for table "${table}"`, 403);
        const final = beforeWrite(s, table, row, undefined)!;
        list.push(final);
        afterWrite(s, table, final);
      }
      save(s);
    },
    async upsert(table, rows) {
      await net('upsert', table, 'write');
      const userId = await requireUser();
      const s = load();
      const c = ctx(s, userId);
      const list = (s.tables[table] ??= []);
      for (const raw0 of rows as R[]) {
        const raw = table === 'patrol_org_settings' ? { ...raw0, id: raw0.org_id } : raw0;
        const idx = list.findIndex((r) => r.id === raw.id);
        const prev = idx >= 0 ? list[idx] : undefined;
        if (!canWrite(c, table, prev ? { ...prev, ...raw } : raw, prev ? 'update' : 'insert')) {
          throw new BackendError('42501', `new row violates row-level security policy for table "${table}"`, 403);
        }
        const final = beforeWrite(s, table, raw, prev);
        if (!final) continue;
        if (idx >= 0) list[idx] = final; else list.push(final);
        afterWrite(s, table, final);
      }
      save(s);
    },
    async update(table, patch, eq) {
      await net('update', table, 'write');
      const userId = await requireUser();
      const s = load();
      const c = ctx(s, userId);
      const list = s.tables[table] ?? [];
      for (let i = 0; i < list.length; i++) {
        const r = list[i]!;
        if (!Object.entries(eq).every(([k, v]) => r[k] === v)) continue;
        if (!visible(s, c, table, r) || !canWrite(c, table, r, 'update')) continue;
        const final = beforeWrite(s, table, { ...(patch as object), id: r.id } as R, r);
        if (!final) continue;
        list[i] = final;
        afterWrite(s, table, final);
      }
      save(s);
    },
    async remove(table, eq) {
      await net('remove', table, 'write');
      const userId = await requireUser();
      const s = load();
      const c = ctx(s, userId);
      s.tables[table] = (s.tables[table] ?? []).filter((r) => !(Object.entries(eq).every(([k, v]) => r[k] === v) && (table === 'patrol_bolos' ? c.staffOrgs.includes(r.org_id) : canWrite(c, table, r, 'update'))));
      save(s);
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      await net('rpc', fn, fn === 'patrol_bootstrap' ? 'read' : 'write');
      const anonOk = fn === 'patrol_get_portal' || fn === 'patrol_get_shared_report';
      const userId = anonOk ? await uid() : await requireUser();
      const s = load();
      const handler = rpcs[fn];
      if (!handler) throw new BackendError('PGRST202', `Could not find the function public.${fn}`, 404);
      const out = handler(s, ctx(s, userId), args);
      save(s);
      return out as T;
    },
    storage: {
      async upload(path, bytes, mime) {
        await net('upload', path, 'upload');
        await requireUser();
        const s = load();
        const head = Array.from(new Uint8Array(bytes.slice(0, 8)), (b) => b.toString(16).padStart(2, '0')).join('');
        s.objects[path] = { mime, size: bytes.byteLength, head };
        save(s);
      },
      async signedUrls(paths) {
        const out: Record<string, string> = {};
        for (const p of paths) out[p] = `data:,mock-${encodeURIComponent(p)}`;
        return out;
      },
    },
  };
}

function bolosPhotos(s: MockState, boloId: string) {
  return (s.tables.patrol_attachments ?? []).filter((x) => x.parent_type === 'bolo' && x.parent_id === boloId && x.kind === 'image' && x.upload_status === 'uploaded')
    .map((x) => ({ path: x.storage_path, thumb: x.thumb_path }));
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function defaultSettings(orgId: string, emails: string[]): R {
  return { id: orgId, org_id: orgId, notify_emails: emails, client_notifications_enabled: false, auto_share_with_client: false, report_prefix: 'LSS', next_report_no: 1, gps_ping_interval_s: 120, ping_retention_days: 30, max_video_mb: 50, max_video_s: 60, tour_interval_min: 60, tour_max_duration_min: 30, email_enabled: false, email_min_severity: 'medium', email_owners_only: true, updated_at: new Date().toISOString() };
}
