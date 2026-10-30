import { enqueue } from './outbox/queue';
import { kick } from './sync/engine';
import { putServerRows, bumpData, listRecords, scopeOf } from './repos/records';
import { db, type Row } from './db';
import { uuidv7 } from '../lib/uuid';
import { identity, currentOrgId, getBackend } from '../auth/session';
import { isNetworkError } from './backend/types';
import type { Category, Checkpoint, Member, Shift, Site, Subtype } from './types';

function ctx() {
  const userId = identity.value?.userId, orgId = currentOrgId.value;
  if (!userId || !orgId) throw new Error('Not signed in');
  return { userId, orgId };
}
const now = () => new Date().toISOString();

async function upsertRow(table: string, row: Row, label: string) {
  const { userId, orgId } = ctx();
  await enqueue({ userId, orgId, kind: 'upsert', table, payload: row, entityKey: `${table}:${row.id}`, label }, [{ table, row, orgId }]);
  bumpData(); void kick();
}

// ---------------------------------------------------------------- sites
export function newSite(): Site {
  return { id: uuidv7(), org_id: currentOrgId.value!, name: '', code: '', kind: 'retail', address: '', city: '', state: 'WA', zip: '', lat: null, lng: null, geofence_m: 150,
    post_orders_html: '', post_orders_updated_at: null, contacts: [], tour_interval_min: 60, tour_max_duration_min: 30, active: true };
}
export async function saveSite(s: Site, postOrdersChanged = false) {
  const row = {
    id: s.id, org_id: s.org_id, name: s.name.trim(), code: (s.code ?? '').trim().toUpperCase() || null, kind: s.kind, address: s.address || null, city: s.city || null,
    state: s.state || 'WA', zip: s.zip || null, lat: s.lat, lng: s.lng, geofence_m: Number(s.geofence_m) || 150, post_orders_html: s.post_orders_html ?? '',
    post_orders_updated_at: postOrdersChanged ? now() : s.post_orders_updated_at, contacts: s.contacts ?? [], tour_interval_min: s.tour_interval_min ?? null,
    tour_max_duration_min: s.tour_max_duration_min ?? null, active: s.active,
  };
  await upsertRow('patrol_sites', row, `Site · ${row.name}`);
}

// ---------------------------------------------------------------- checkpoints
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function genCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALPHABET[b % 32]).join('');
}
export async function saveCheckpoint(c: Checkpoint) {
  const row = { id: c.id, org_id: c.org_id, site_id: c.site_id, name: c.name.trim(), seq: c.seq, code: c.code, lat: c.lat, lng: c.lng, radius_m: Number(c.radius_m) || 40, instructions: c.instructions || null, active: c.active };
  await upsertRow('patrol_checkpoints', row, `Checkpoint · ${row.name}`);
}
export async function reorderCheckpoints(list: Checkpoint[]) {
  for (let i = 0; i < list.length; i++) if (list[i]!.seq !== i + 1) await saveCheckpoint({ ...list[i]!, seq: i + 1 });
}

// ---------------------------------------------------------------- categories
export async function saveCategory(c: Category) {
  const row = { id: c.id, org_id: c.org_id, name: c.name.trim(), color: c.color, icon: c.icon, sort: c.sort, hidden: c.hidden, required_fields: c.required_fields, default_severity: c.default_severity, use_for: c.use_for };
  await upsertRow('patrol_categories', row, `Category · ${row.name}`);
}
export async function reorderCategories(ids: string[]) {
  const { userId, orgId } = ctx();
  const d = await db();
  for (let i = 0; i < ids.length; i++) {
    const rec = await d.get('records', ['patrol_categories', ids[i]!]);
    if (rec) await d.put('records', { ...rec, data: { ...rec.data, sort: i } });
  }
  await enqueue({ userId, orgId, kind: 'rpc', rpc: 'patrol_reorder_categories', payload: { p_org: orgId, p_ids: ids }, entityKey: `reorder:categories:${orgId}`, label: 'Reorder categories' });
  bumpData(); void kick();
}
export async function saveSubtype(s: Subtype) {
  await upsertRow('patrol_subtypes', { id: s.id, org_id: s.org_id, category_id: s.category_id, name: s.name.trim(), sort: s.sort, hidden: s.hidden }, `Subtype · ${s.name}`);
}

// ---------------------------------------------------------------- shifts
export async function saveShift(s: Shift, repeatWeeks = 0) {
  const base = { org_id: s.org_id, site_id: s.site_id, member_id: s.member_id, notes: s.notes || null, cancelled_at: s.cancelled_at };
  await upsertRow('patrol_shifts', { id: s.id, ...base, starts_at: s.starts_at, ends_at: s.ends_at }, 'Shift');
  for (let w = 1; w <= repeatWeeks; w++) {
    const add = w * 7 * 864e5;
    await upsertRow('patrol_shifts', { id: uuidv7(), ...base, starts_at: new Date(Date.parse(s.starts_at) + add).toISOString(), ends_at: new Date(Date.parse(s.ends_at) + add).toISOString() }, 'Shift (repeat)');
  }
}
export async function cancelShift(s: Shift) {
  await upsertRow('patrol_shifts', { id: s.id, org_id: s.org_id, site_id: s.site_id, member_id: s.member_id, starts_at: s.starts_at, ends_at: s.ends_at, notes: s.notes, cancelled_at: now() }, 'Cancel shift');
}

// ---------------------------------------------------------------- people
export async function setSiteAccess(siteId: string, memberId: string, on: boolean) {
  const { userId, orgId } = ctx();
  const id = `${siteId}:${memberId}`;
  if (on) {
    await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_site_access', payload: { org_id: orgId, site_id: siteId, member_id: memberId }, entityKey: `patrol_site_access:${id}`, label: 'Assign site' },
      [{ table: 'patrol_site_access', row: { id, org_id: orgId, site_id: siteId, member_id: memberId }, orgId }]);
  } else {
    await enqueue({ userId, orgId, kind: 'delete', table: 'patrol_site_access', payload: null, match: { site_id: siteId, member_id: memberId }, entityKey: `patrol_site_access:${id}`, label: 'Remove site' });
    await (await db()).delete('records', ['patrol_site_access', id]);
  }
  bumpData(); void kick();
}
export async function updateMember(m: Member, patch: Partial<Pick<Member, 'role' | 'status' | 'display_name' | 'phone' | 'gusto_employee_id'>>) {
  const { userId, orgId } = ctx();
  await enqueue({ userId, orgId, kind: 'update', table: 'patrol_members', payload: patch, match: { id: m.id }, entityKey: `patrol_members:${m.id}`, label: `Update ${m.display_name}` },
    [{ table: 'patrol_members', row: { id: m.id, ...patch }, orgId }]);
  bumpData(); void kick();
}
export interface InviteResult { invite_id: string; code: string }
export async function createInvite(role: string, siteIds: string[], email: string | null, displayName: string | null, ttlHours = 168): Promise<InviteResult> {
  const { orgId } = ctx();
  return getBackend().rpc<InviteResult>('patrol_create_invite', { p_org: orgId, p_role: role, p_site_ids: siteIds, p_email: email || null, p_display_name: displayName || null, p_ttl_hours: ttlHours, p_max_uses: 1 });
}
/** Network refresh (call from an effect, not from useData: it bumps the data version). */
export async function fetchInvites() {
  const { orgId } = ctx();
  try { await putServerRows('patrol_invites', await getBackend().select<Row>('patrol_invites', { eq: { org_id: orgId }, order: ['created_at', 'desc'], limit: 50 })); } catch { /* offline: cached */ }
}
export async function listInvites(): Promise<Row[]> {
  const { orgId } = ctx();
  return listRecords<Row>('patrol_invites', orgId);
}
export async function revokeInvite(id: string) {
  await getBackend().update('patrol_invites', { revoked_at: now() }, { id });
  await fetchInvites();
}

// ---------------------------------------------------------------- review / alerts (online RPCs; queued when offline)
async function rpcOrQueue(fn: string, args: Record<string, unknown>, entity: string, label: string, local?: { table: string; row: Row }) {
  const { userId, orgId } = ctx();
  if (local) {
    const d = await db();
    const rec = await d.get('records', [local.table, local.row.id]);
    if (rec) await d.put('records', { ...rec, data: { ...rec.data, ...local.row } });
    bumpData();
  }
  try {
    await getBackend().rpc(fn, args);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue({ userId, orgId, kind: 'rpc', rpc: fn, payload: args, entityKey: entity, label });
  }
}
export const setAlertStatus = (id: string, status: 'acknowledged' | 'resolved', note?: string) =>
  rpcOrQueue('patrol_alert_set_status', { p_id: id, p_status: status, p_note: note ?? null }, `patrol_alerts:${id}`, `SOS ${status}`, { table: 'patrol_alerts', row: { id, status, [`${status}_at`]: now() } });
export const setIncidentStatus = (id: string, status: string, severity?: string, note?: string) =>
  rpcOrQueue('patrol_set_incident_status', { p_id: id, p_status: status, p_note: note ?? null, p_severity: severity ?? null }, `patrol_incidents:${id}:review`, `Incident ${status.replace(/_/g, ' ')}`,
    { table: 'patrol_incidents', row: { id, status, ...(severity ? { severity } : {}), ...(status === 'sent_to_client' ? { client_visible: true } : {}) } });
export const setIncidentClientVisible = (id: string, visible: boolean) =>
  rpcOrQueue('patrol_set_incident_client_visible', { p_id: id, p_visible: visible }, `patrol_incidents:${id}:visible`, visible ? 'Share with client' : 'Hide from client', { table: 'patrol_incidents', row: { id, client_visible: visible } });
export const addIncidentNote = (id: string, body: string) =>
  rpcOrQueue('patrol_add_incident_note', { p_id: id, p_body: body, p_internal: true }, `patrol_incidents:${id}:note`, 'Internal note');
export const setDarStatus = (id: string, status: string) =>
  rpcOrQueue('patrol_set_dar_status', { p_id: id, p_status: status }, `patrol_dars:${id}:review`, `DAR ${status}`, { table: 'patrol_dars', row: { id, status, ...(status === 'sent_to_client' ? { client_visible: true } : {}) } });

export async function saveOrgSettings(row: Row) {
  const { userId, orgId } = ctx();
  // patrol_org_settings is keyed by org_id (no id column): keep `id` only in the local cache.
  // UPDATE (not upsert): the row always exists and RLS grants admins UPDATE only, no INSERT.
  const { id: _local, next_report_no: _n, updated_at: _u, org_id: _o, ...payload } = row as Row & { next_report_no?: number; updated_at?: string; org_id?: string };
  await enqueue({ userId, orgId, kind: 'update', table: 'patrol_org_settings', payload, match: { org_id: orgId }, entityKey: `patrol_org_settings:${orgId}`, label: 'Organization settings' },
    [{ table: 'patrol_org_settings', row: { ...row, id: orgId }, orgId }]);
  bumpData(); void kick();
}

// ---------------------------------------------------------------- dashboard data
let refreshing: Promise<void> | null = null;
/** Pull recent operational records for staff screens (feed, live, review). */
export function refreshDashboard(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const orgId = currentOrgId.value;
    if (!orgId) return;
    const b = getBackend();
    const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
    const jobs: Array<[string, Parameters<typeof b.select>[1]]> = [
      ['patrol_member_status', { eq: { org_id: orgId } }],
      ['patrol_alerts', { eq: { org_id: orgId }, gte: { triggered_at: since(14) }, order: ['triggered_at', 'desc'], limit: 100 }],
      ['patrol_incidents', { eq: { org_id: orgId }, gte: { occurred_at: since(30) }, order: ['occurred_at', 'desc'], limit: 200 }],
      ['patrol_scans', { eq: { org_id: orgId }, gte: { scanned_at: since(7) }, order: ['scanned_at', 'desc'], limit: 800 }],
      ['patrol_tour_runs', { eq: { org_id: orgId }, gte: { started_at: since(7) }, order: ['started_at', 'desc'], limit: 300 }],
      ['patrol_time_entries', { eq: { org_id: orgId }, gte: { clock_in_at: since(7) }, order: ['clock_in_at', 'desc'], limit: 200 }],
      ['patrol_dar_entries', { eq: { org_id: orgId }, gte: { occurred_at: since(7) }, order: ['occurred_at', 'desc'], limit: 500 }],
      ['patrol_dars', { eq: { org_id: orgId }, gte: { report_date: since(30).slice(0, 10) }, order: ['report_date', 'desc'], limit: 100 }],
      ['patrol_shifts', { eq: { org_id: orgId }, gte: { ends_at: since(7) }, order: ['starts_at', 'asc'], limit: 400 }],
      ['patrol_bolos', { eq: { org_id: orgId }, gte: { updated_at: since(90) }, order: ['created_at', 'desc'], limit: 200 }],
    ];
    await Promise.all(jobs.map(async ([t, q]) => {
      try {
        const startedAt = Date.now();
        const rows = await b.select<Row>(t, q);
        const withId = t === 'patrol_member_status' ? rows.map((r) => ({ ...r, id: String(r.member_id) })) : rows;
        // Reconcile: rows in this window that the server no longer returns were deleted or moved.
        await putServerRows(t, withId, { scope: scopeOf(q ?? {}, withId, startedAt) });
      } catch { /* offline or RLS: keep cache */ }
    }));
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function fetchIncidentExtras(incidentId: string) {
  const b = getBackend();
  try {
    const [atts, events] = await Promise.all([
      b.select<Row>('patrol_attachments', { eq: { parent_id: incidentId } }),
      b.select<Row>('patrol_incident_events', { eq: { incident_id: incidentId }, order: ['created_at', 'asc'] }),
    ]);
    await putServerRows('patrol_attachments', atts);
    await putServerRows('patrol_incident_events', events);
  } catch { /* offline */ }
}

// ---------------------------------------------------------------- client portal links
/** Network refresh (call from an effect, not from useData: it bumps the data version). */
export async function fetchPortalLinks(siteId: string) {
  try { await putServerRows('patrol_portal_links', await getBackend().select<Row>('patrol_portal_links', { eq: { site_id: siteId }, order: ['created_at', 'desc'] })); } catch { /* offline */ }
}
export async function listPortalLinks(siteId: string): Promise<Row[]> {
  const { orgId } = ctx();
  return (await listRecords<Row>('patrol_portal_links', orgId)).filter((l) => l.site_id === siteId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
export async function createPortalLink(siteId: string, days: number): Promise<{ id: string; token: string; expires_at: string | null }> {
  return getBackend().rpc('patrol_create_portal_link', { p_site: siteId, p_days: days, p_label: 'Client portal' });
}
export async function revokePortalLink(id: string) {
  await getBackend().rpc('patrol_revoke_portal_link', { p_id: id });
}

// ---------------------------------------------------------------- site photos (item 19)
/** Upload/replace a site's photo (patrol_attachments parent 'site', private patrol-media bucket). */
export async function setSitePhoto(siteId: string, file: File) {
  const { prepareWithLimits } = await import('../ui/Attachments');
  const { addAttachment, removeAttachment, listAttachments } = await import('./guard');
  const prepared = await prepareWithLimits(file);
  if (prepared.kind !== 'image') throw new Error('Choose a photo (JPEG, PNG or HEIC).');
  const old = (await listAttachments(siteId)).filter((a) => a.parent_type === 'site');
  await addAttachment('site', siteId, prepared);
  for (const a of old) await removeAttachment(a);
}
