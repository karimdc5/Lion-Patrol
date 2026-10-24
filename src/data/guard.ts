import { signal } from '@preact/signals';
import { enqueue, getOp, discardOp } from './outbox/queue';
import { kick } from './sync/engine';
import { db, kvGet, kvSet, type Row } from './db';
import { listRecords, getRecord, bumpData } from './repos/records';
import { uuidv7 } from '../lib/uuid';
import { getFix, startWatch, stopWatch, distanceM, type Fix } from '../lib/geo';
import { siteLocalDate } from '../lib/format';
import { identity, currentOrgId, memberId, membership } from '../auth/session';
import { NOTICE_VERSIONS } from '../config';
import { evaluateScan, parseCheckpointCode } from '../domain/tour';
import type { IncidentForm } from '../domain/incident';
import type { Prepared } from '../media/compress';
import type { Checkpoint, Consent, PublicSettings, TimeEntry } from './types';

// ---------------------------------------------------------------- context helpers
export function deviceId(): string {
  let d = localStorage.getItem('lp-device');
  if (!d) { d = uuidv7(); localStorage.setItem('lp-device', d); }
  return d;
}
function ctx() {
  const userId = identity.value?.userId;
  const orgId = currentOrgId.value;
  const mid = memberId.value;
  if (!userId || !orgId || !mid) throw new Error('Not signed in to an organization');
  return { userId, orgId, memberId: mid, name: membership.value?.display_name ?? '' };
}
/** Monotonic per-device revision for last-writer-wins updates (fits in int4). */
let lastRev = 0;
export function clientRev(): number {
  const r = Math.max(lastRev + 1, Math.floor((Date.now() - 1.7e12) / 100));
  lastRev = r;
  return r;
}
const nowIso = () => new Date().toISOString();

async function rememberOp(table: string, id: string, opId: string) { await kvSet(`op:${table}:${id}`, opId); }
/** Op id that created a parent row, if it hasn't completed yet (for dependsOn). */
async function parentDep(table: string, id: string): Promise<string[]> {
  const opId = await kvGet<string>(`op:${table}:${id}`);
  if (!opId) return [];
  const op = await getOp(opId);
  return op && op.status !== 'done' ? [opId] : [];
}
async function settings(orgId: string) {
  return (await listRecords<PublicSettings>('patrol_public_settings', orgId))[0] ?? null;
}

// ---------------------------------------------------------------- consents
export async function hasConsent(kind: 'gps_notice' | 'audio_notice'): Promise<boolean> {
  const { orgId, memberId: mid } = ctx();
  const list = await listRecords<Consent>('patrol_consents', orgId);
  return list.some((c) => c.member_id === mid && c.kind === kind && c.version >= NOTICE_VERSIONS[kind]);
}
export async function acceptConsent(kind: 'gps_notice' | 'audio_notice'): Promise<string> {
  const { userId, orgId, memberId: mid } = ctx();
  const row = { id: uuidv7(), org_id: orgId, member_id: mid, kind, version: NOTICE_VERSIONS[kind], accepted_at: nowIso(), device_id: deviceId(), user_agent: navigator.userAgent.slice(0, 200) };
  await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_consents', payload: row, entityKey: `patrol_consents:${row.id}`, label: kind === 'gps_notice' ? 'Location notice accepted' : 'Recording notice accepted' },
    [{ table: 'patrol_consents', row, orgId }]);
  bumpData(); void kick();
  return row.accepted_at;
}

// ---------------------------------------------------------------- shift
export const onShift = signal<TimeEntry | null>(null);

export async function loadOpenEntry(): Promise<TimeEntry | null> {
  const orgId = currentOrgId.value, mid = memberId.value;
  if (!orgId || !mid) { onShift.value = null; return null; }
  const te = (await listRecords<TimeEntry>('patrol_time_entries', orgId)).find((t) => t.member_id === mid && !t.clock_out_at) ?? null;
  onShift.value = te;
  if (te) ensureWatching(); else stopWatch();
  return te;
}

export async function openDar(): Promise<(Row & { status: string }) | null> {
  const te = onShift.value;
  if (!te) return null;
  const dars = await listRecords<Row & { status: string; time_entry_id: string }>('patrol_dars', te.org_id);
  return dars.find((d) => d.time_entry_id === te.id) ?? null;
}

export async function clockIn(siteId: string, shiftId: string | null, gpsAcceptedAt: string): Promise<TimeEntry> {
  const { userId, orgId, memberId: mid, name } = ctx();
  const fix = await getFix(8000);
  const at = nowIso();
  const te: TimeEntry & Row = {
    id: uuidv7(), org_id: orgId, site_id: siteId, member_id: mid, shift_id: shiftId, clock_in_at: at,
    clock_in_lat: fix?.lat ?? null, clock_in_lng: fix?.lng ?? null, clock_in_accuracy_m: fix?.accuracy ?? null,
    clock_out_at: null, shift_note: null, gps_notice_accepted_at: gpsAcceptedAt, client_created_at: at, device_id: deviceId(),
  } as TimeEntry & Row;
  const teOp = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_time_entries', payload: te, entityKey: `patrol_time_entries:${te.id}`, label: 'Clock in' },
    [{ table: 'patrol_time_entries', row: te, orgId }]);
  await rememberOp('patrol_time_entries', te.id, teOp);
  const dar = { id: uuidv7(), org_id: orgId, site_id: siteId, member_id: mid, time_entry_id: te.id, report_date: siteLocalDate(at), status: 'open', client_rev: clientRev(), client_created_at: at, device_id: deviceId() };
  const darOp = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_dars', payload: dar, entityKey: `patrol_dars:${dar.id}`, dependsOn: [teOp], label: 'Daily activity report' },
    [{ table: 'patrol_dars', row: { ...dar, author_name: name }, orgId }]);
  await rememberOp('patrol_dars', dar.id, darOp);
  onShift.value = te;
  lastPing = { at: Date.now(), fix };
  ensureWatching();
  bumpData(); void kick();
  return te;
}

export async function clockOut(note: string, summary: string): Promise<void> {
  const { userId, orgId } = ctx();
  const te = onShift.value;
  if (!te) return;
  const fix = await getFix(6000);
  const at = nowIso();
  const patch = { clock_out_at: at, clock_out_lat: fix?.lat ?? null, clock_out_lng: fix?.lng ?? null, clock_out_accuracy_m: fix?.accuracy ?? null, shift_note: note.trim() || null };
  await enqueue({ userId, orgId, kind: 'update', table: 'patrol_time_entries', payload: patch, match: { id: te.id }, entityKey: `patrol_time_entries:${te.id}`, label: 'Clock out' },
    [{ table: 'patrol_time_entries', row: { id: te.id, ...patch }, orgId }]);
  const dar = await openDar();
  if (dar) {
    const darPatch = { status: 'submitted', summary: summary.trim() || note.trim() || null, client_rev: clientRev() };
    await enqueue({ userId, orgId, kind: 'update', table: 'patrol_dars', payload: darPatch, match: { id: dar.id }, entityKey: `patrol_dars:${dar.id}`, label: 'Submit daily activity report' },
      [{ table: 'patrol_dars', row: { id: dar.id, ...darPatch, submitted_at: at }, orgId }]);
  }
  stopWatch();
  onShift.value = null;
  bumpData(); void kick();
}

// ---------------------------------------------------------------- location pings (on shift, foreground only)
let lastPing: { at: number; fix: Fix | null } = { at: 0, fix: null };
function ensureWatching() {
  if (document.visibilityState !== 'visible') return;
  startWatch((fix) => void onFix(fix));
}
async function onFix(fix: Fix) {
  const te = onShift.value;
  if (!te) { stopWatch(); return; }
  const s = await settings(te.org_id);
  const interval = (s?.gps_ping_interval_s ?? 120) * 1000;
  const moved = lastPing.fix ? distanceM(lastPing.fix, fix) : Infinity;
  if (Date.now() - lastPing.at < interval && moved < 50) return;
  lastPing = { at: Date.now(), fix };
  const { userId } = ctx();
  const row = { id: uuidv7(), org_id: te.org_id, member_id: te.member_id, time_entry_id: te.id, lat: fix.lat, lng: fix.lng, accuracy_m: Math.round(fix.accuracy), recorded_at: nowIso() };
  await enqueue({ userId, orgId: te.org_id, kind: 'insert', table: 'patrol_location_pings', payload: row, entityKey: `patrol_location_pings:${row.id}`, dependsOn: await parentDep('patrol_time_entries', te.id), label: 'Location update' });
  void kick();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && onShift.value) ensureWatching();
    else if (document.visibilityState === 'hidden') stopWatch();
  });
}

// ---------------------------------------------------------------- patrol tours
export interface ScanResult { checkpoint: Checkpoint; flags: string[]; done: number; total: number; scanId: string }

export async function openRun(siteId: string) {
  const te = onShift.value;
  if (!te) return null;
  const runs = await listRecords<Row & { site_id: string; member_id: string; completed_at: string | null; started_at: string; time_entry_id: string }>('patrol_tour_runs', te.org_id);
  return runs.filter((r) => r.site_id === siteId && r.member_id === te.member_id && r.time_entry_id === te.id && !r.completed_at)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
}

export async function scanCheckpoint(raw: string, method: 'qr' | 'manual', note?: string): Promise<ScanResult> {
  const { userId, orgId, memberId: mid } = ctx();
  const te = onShift.value;
  if (!te) throw new Error('Clock in before scanning checkpoints.');
  const code = parseCheckpointCode(raw);
  const all = (await listRecords<Checkpoint>('patrol_checkpoints', orgId)).filter((c) => c.active);
  const cp = all.find((c) => parseCheckpointCode(c.code) === code);
  if (!cp) throw new Error('That code doesn’t match a checkpoint. Check the sticker and try again.');
  if (cp.site_id !== te.site_id) throw new Error('That checkpoint belongs to a different site than your shift.');
  const siteCps = all.filter((c) => c.site_id === cp.site_id).sort((a, b) => a.seq - b.seq);
  const s = await settings(orgId);
  const site = await getRecord<Row & { tour_max_duration_min: number | null }>('patrol_sites', cp.site_id);
  const maxMin = site?.tour_max_duration_min ?? s?.tour_max_duration_min ?? 30;

  let run = await openRun(cp.site_id);
  const deps: string[] = [];
  if (!run) {
    const r = { id: uuidv7(), org_id: orgId, site_id: cp.site_id, member_id: mid, time_entry_id: te.id, started_at: nowIso(), expected_count: siteCps.length, client_created_at: nowIso(), device_id: deviceId() };
    const runOp = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_tour_runs', payload: r, entityKey: `patrol_tour_runs:${r.id}`, dependsOn: await parentDep('patrol_time_entries', te.id), label: 'Patrol tour started' },
      [{ table: 'patrol_tour_runs', row: { ...r, scanned_count: 0, completed_at: null }, orgId }]);
    await rememberOp('patrol_tour_runs', r.id, runOp);
    run = { ...r, completed_at: null } as unknown as typeof run;
  }
  deps.push(...(await parentDep('patrol_tour_runs', run!.id)));
  const prior = (await listRecords<Row & { tour_run_id: string; checkpoint_id: string; flags: string[] }>('patrol_scans', orgId)).filter((x) => x.tour_run_id === run!.id);
  const fix = await getFix(5000);
  const { flags, distance } = evaluateScan({
    checkpoint: cp, checkpoints: siteCps, prior, runStartedAt: Date.parse(run!.started_at), now: Date.now(), maxDurationMin: maxMin,
    fix: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null, distance: distanceM,
  });
  const scan = { id: uuidv7(), org_id: orgId, site_id: cp.site_id, member_id: mid, checkpoint_id: cp.id, tour_run_id: run!.id, time_entry_id: te.id, scanned_at: nowIso(),
    lat: fix?.lat ?? null, lng: fix?.lng ?? null, accuracy_m: fix ? Math.round(fix.accuracy) : null, distance_m: distance, method, flags, note: note?.trim() || null, client_created_at: nowIso(), device_id: deviceId() };
  const scanOp = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_scans', payload: scan, entityKey: `patrol_scans:${scan.id}`, dependsOn: deps, label: `Checkpoint · ${cp.name}` },
    [{ table: 'patrol_scans', row: scan, orgId, parentId: run!.id }]);
  await rememberOp('patrol_scans', scan.id, scanOp);
  const distinct = new Set([...prior.filter((p) => !p.flags.includes('duplicate')).map((p) => p.checkpoint_id), ...(flags.includes('duplicate') ? [] : [cp.id])]);
  const runRow = { id: run!.id, scanned_count: distinct.size, completed_at: distinct.size >= siteCps.length ? scan.scanned_at : null };
  const d = await db();
  const rec = await d.get('records', ['patrol_tour_runs', run!.id]);
  if (rec) await d.put('records', { ...rec, data: { ...rec.data, ...runRow } });
  bumpData(); void kick();
  return { checkpoint: cp, flags, done: distinct.size, total: siteCps.length, scanId: scan.id };
}

export async function updateScanNote(scanId: string, note: string) {
  // Scans are immutable server-side; notes are captured before saving or as a DAR entry.
  return addDarEntry(note, null, scanId);
}

// ---------------------------------------------------------------- DAR
export async function addDarEntry(body: string, categoryId: string | null, _ref?: string): Promise<string> {
  const { userId, orgId, memberId: mid } = ctx();
  const dar = await openDar();
  if (!dar) throw new Error('Clock in to add log entries.');
  const cat = categoryId ? await getRecord<Row & { name: string }>('patrol_categories', categoryId) : null;
  const fix = await getFix(3000);
  const e = { id: uuidv7(), org_id: orgId, site_id: dar.site_id as string, member_id: mid, dar_id: dar.id, occurred_at: nowIso(), category_id: categoryId, category_name: cat?.name ?? null, body: body.trim(),
    lat: fix?.lat ?? null, lng: fix?.lng ?? null, accuracy_m: fix ? Math.round(fix.accuracy) : null, client_rev: clientRev(), client_created_at: nowIso(), device_id: deviceId() };
  const op = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_dar_entries', payload: e, entityKey: `patrol_dar_entries:${e.id}`, dependsOn: await parentDep('patrol_dars', dar.id), label: 'Log entry' },
    [{ table: 'patrol_dar_entries', row: e, orgId, parentId: dar.id }]);
  await rememberOp('patrol_dar_entries', e.id, op);
  bumpData(); void kick();
  return e.id;
}

// ---------------------------------------------------------------- incidents
export async function loadDraft(id: string): Promise<IncidentForm | null> {
  const d = await (await db()).get('drafts', id);
  return (d?.data as IncidentForm) ?? null;
}
export async function listDrafts(): Promise<IncidentForm[]> {
  const uid = identity.value?.userId;
  if (!uid) return [];
  const all = await (await db()).getAllFromIndex('drafts', 'byUser', uid);
  return all.filter((d) => d.kind === 'incident').sort((a, b) => b.updatedAt - a.updatedAt).map((d) => d.data as IncidentForm);
}
export async function saveDraftLocal(f: IncidentForm) {
  const uid = ctx().userId;
  await (await db()).put('drafts', { id: f.id, userId: uid, kind: 'incident', data: f, updatedAt: Date.now() });
}
export async function discardDraft(id: string) {
  await (await db()).delete('drafts', id);
  bumpData();
}

function incidentPayload(f: IncidentForm, status: 'draft' | 'submitted', orgId: string, mid: string) {
  const est = f.damage_estimate_usd.replace(/[$,]/g, '');
  return {
    id: f.id, org_id: orgId, site_id: f.site_id, member_id: mid, time_entry_id: f.time_entry_id, category_id: f.category_id, subtype_id: f.subtype_id,
    title: f.title.trim(), occurred_at: f.occurred_at, location_text: f.location_text.trim() || null, lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m,
    description: f.description, people: f.people, vehicles: f.vehicles, police_called: !!f.police_called, police_agency: f.police_agency || null,
    police_case_no: f.police_case_no || null, officer_name: f.officer_name || null, ems_called: f.ems_called, fire_called: f.fire_called,
    injury: f.injury, injury_details: f.injury_details || null, property_damage: f.property_damage, damage_estimate_usd: est ? Number(est) : null,
    severity: f.severity, status, client_rev: clientRev(), client_created_at: f.created_at, device_id: deviceId(),
  };
}

/** Upsert the server-side draft (coalesced while pending). Returns the op id. */
export async function syncDraft(f: IncidentForm): Promise<string | null> {
  if (!f.site_id || !f.category_id) return null;
  const { userId, orgId, memberId: mid } = ctx();
  const p = incidentPayload(f, 'draft', orgId, mid);
  const op = await enqueue({ userId, orgId, kind: 'upsert', table: 'patrol_incidents', payload: p, entityKey: `patrol_incidents:${f.id}`, label: `Draft · ${f.title || 'Incident'}` },
    [{ table: 'patrol_incidents', row: { ...p, author_name: ctx().name }, orgId }]);
  await rememberOp('patrol_incidents', f.id, op);
  void kick();
  return op;
}

export async function submitIncident(f: IncidentForm): Promise<void> {
  const { userId, orgId, memberId: mid } = ctx();
  const p = incidentPayload(f, 'submitted', orgId, mid);
  const atts = await listAttachments(f.id);
  const uploadDeps: string[] = [];
  for (const a of atts) uploadDeps.push(...(await parentDep('upload', a.id)));
  const submitOp = await enqueue({ userId, orgId, kind: 'upsert', table: 'patrol_incidents', payload: p, entityKey: `patrol_incidents:${f.id}`, dependsOn: uploadDeps, noCoalesce: true, label: `Incident · ${f.title || 'Report'}` },
    [{ table: 'patrol_incidents', row: { ...p, author_name: ctx().name, submitted_at: nowIso() }, orgId }]);
  await enqueue({ userId, orgId, kind: 'email', payload: { event: 'incident', id: f.id, orgId }, entityKey: `email:incident:${f.id}`, dependsOn: [submitOp], label: 'Notify owners (email)' });
  await discardDraft(f.id);
  bumpData(); void kick();
}

// ---------------------------------------------------------------- attachments
export type ParentType = 'incident' | 'dar_entry' | 'scan' | 'alert';
export interface AttachmentRow extends Row { parent_type: ParentType; parent_id: string; kind: string; mime: string; size_bytes: number; storage_path: string; thumb_path: string | null; upload_status: string; duration_s: number | null; caption: string | null; client_created_at?: string }

export async function listAttachments(parentId: string): Promise<AttachmentRow[]> {
  const recs = await (await db()).getAllFromIndex('records', 'byTableParent', ['patrol_attachments', parentId]);
  return recs.map((r) => ({ ...(r.data as AttachmentRow), _pending: !!r._pending })).sort((a, b) => String(a.client_created_at).localeCompare(String(b.client_created_at)));
}

export async function addAttachment(parentType: ParentType, parentId: string, prepared: Prepared, parentOp?: string | null): Promise<AttachmentRow> {
  const { userId, orgId, memberId: mid } = ctx();
  const id = uuidv7();
  const base = `${orgId}/${parentType}/${parentId}/${id}`;
  const row: AttachmentRow = {
    id, org_id: orgId, member_id: mid, parent_type: parentType, parent_id: parentId, kind: prepared.kind,
    storage_path: `${base}.${prepared.ext}`, thumb_path: prepared.thumb ? `${base}.thumb.jpg` : null, mime: prepared.mime, size_bytes: prepared.bytes.byteLength,
    width: prepared.width ?? null, height: prepared.height ?? null, duration_s: prepared.durationS ?? null, caption: null, upload_status: 'pending',
    client_created_at: nowIso(), device_id: deviceId(),
  } as AttachmentRow;
  const parentTable = { incident: 'patrol_incidents', dar_entry: 'patrol_dar_entries', scan: 'patrol_scans', alert: 'patrol_alerts' }[parentType];
  const deps = parentOp ? [parentOp] : await parentDep(parentTable, parentId);
  const blob = { id, mime: prepared.mime, bytes: prepared.bytes, thumb: prepared.thumb, size: prepared.bytes.byteLength, state: 'local' as const, uploadedAt: null, createdAt: Date.now() };
  const { upload_status: _u, ...payload } = row;
  const rowOp = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_attachments', payload, entityKey: `patrol_attachments:${id}`, dependsOn: deps, label: `${labelFor(prepared.kind)} details` },
    [{ table: 'patrol_attachments', row, orgId, parentId }], [blob]);
  await rememberOp('patrol_attachments', id, rowOp);
  const upOp = await enqueue({ userId, orgId, kind: 'upload', payload: { blobId: id, path: row.storage_path, thumbPath: row.thumb_path, mime: row.mime, attachmentId: id },
    entityKey: `upload:${id}`, dependsOn: [rowOp], label: `${labelFor(prepared.kind)} upload` });
  await rememberOp('upload', id, upOp);
  bumpData(); void kick();
  return row;
}

export async function removeAttachment(a: AttachmentRow) {
  const { userId, orgId } = ctx();
  const rowOp = await kvGet<string>(`op:patrol_attachments:${a.id}`);
  const upOp = await kvGet<string>(`op:upload:${a.id}`);
  const rowDone = rowOp ? (await getOp(rowOp))?.status === 'done' || !(await getOp(rowOp)) : true;
  if (upOp) await discardOp(upOp);
  if (rowOp && !rowDone) await discardOp(rowOp);
  const d = await db();
  await d.delete('records', ['patrol_attachments', a.id]);
  await d.delete('blobs', a.id);
  if (rowDone) {
    await enqueue({ userId, orgId, kind: 'delete', table: 'patrol_attachments', payload: null, match: { id: a.id }, entityKey: `patrol_attachments:${a.id}:delete`, label: 'Remove attachment' });
    void kick();
  }
  bumpData();
}

export function labelFor(kind: string) {
  return ({ image: 'Photo', video: 'Video', audio: 'Audio', voice_note: 'Voice note', document: 'Document' } as Record<string, string>)[kind] ?? 'File';
}

// ---------------------------------------------------------------- SOS
export async function triggerSos(): Promise<string> {
  const { userId, orgId, memberId: mid, name } = ctx();
  const te = onShift.value;
  const fix = await getFix(2500);
  const at = nowIso();
  const row = { id: uuidv7(), org_id: orgId, site_id: te?.site_id ?? null, member_id: mid, time_entry_id: te?.id ?? null, triggered_at: at,
    lat: fix?.lat ?? null, lng: fix?.lng ?? null, accuracy_m: fix ? Math.round(fix.accuracy) : null, status: 'open', client_created_at: at, device_id: deviceId() };
  const op = await enqueue({ userId, orgId, kind: 'insert', table: 'patrol_alerts', payload: row, entityKey: `patrol_alerts:${row.id}`, priority: 0, label: 'SOS alert' },
    [{ table: 'patrol_alerts', row: { ...row, member_name: name }, orgId }]);
  await rememberOp('patrol_alerts', row.id, op);
  await enqueue({ userId, orgId, kind: 'email', payload: { event: 'sos', id: row.id, orgId }, entityKey: `email:sos:${row.id}`, dependsOn: [op], priority: 0, label: 'Notify owners of SOS (email)' });
  bumpData();
  void kick();
  return row.id;
}

export async function cancelSos(alertId: string) {
  const { userId, orgId } = ctx();
  await enqueue({ userId, orgId, kind: 'rpc', rpc: 'patrol_alert_set_status', payload: { p_id: alertId, p_status: 'cancelled', p_note: 'Guard marked safe' },
    entityKey: `patrol_alerts:${alertId}`, dependsOn: await parentDep('patrol_alerts', alertId), priority: 0, label: 'SOS cancelled (safe)' },
    [{ table: 'patrol_alerts', row: { id: alertId, status: 'cancelled', cancelled_at: nowIso() }, orgId }]);
  bumpData(); void kick();
}

export async function opState(table: string, id: string): Promise<'pending' | 'done' | 'dead'> {
  const opId = await kvGet<string>(`op:${table}:${id}`);
  if (!opId) return 'done';
  const op = await getOp(opId);
  if (!op || op.status === 'done') return 'done';
  return op.status === 'dead' ? 'dead' : 'pending';
}
