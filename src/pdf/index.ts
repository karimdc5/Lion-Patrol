import { PUBLIC_URL, COMPANY_NAME } from '../config';
import type { Checkpoint, Site } from '../data/types';

async function logo(): Promise<Uint8Array | null> {
  try { return new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}brand/logo-pdf.png`)).arrayBuffer()); } catch { return null; }
}

export async function qrSheetPdf(site: Site, cps: Checkpoint[], orgName = COMPANY_NAME) {
  const { buildQrSheet } = await import('./qrSheet');
  const base = location.origin.includes('localhost') || location.origin.includes('127.0.0.1') ? location.origin + import.meta.env.BASE_URL : PUBLIC_URL;
  const bytes = await buildQrSheet({
    orgName, siteName: site.name, siteAddress: [site.address, site.city].filter(Boolean).join(', '), baseUrl: base,
    checkpoints: cps.map((c) => ({ name: c.name, code: c.code, seq: c.seq, instructions: c.instructions })), logoPng: await logo(),
  });
  return { bytes, pages: cps.length, filename: `QR-${(site.code || site.name).replace(/[^A-Za-z0-9]+/g, '-')}.pdf` };
}

// ---------------------------------------------------------------- incident + DAR reports
import { getRecord, listRecords, listByParent, putServerRows } from '../data/repos/records';
import { db, type Row } from '../data/db';
import { getBackend } from '../auth/session';
import { isNetworkError } from '../data/backend/types';
import type { OrgInfo, PdfPhoto } from './report';
import { extraDetails, type FieldConfig } from '../domain/incident';

const TZ = 'America/Los_Angeles';
const timeLabel = (iso: unknown) => (iso ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(String(iso))) : '');

async function orgInfo(orgId: string): Promise<OrgInfo> {
  const o = await getRecord<Row>('patrol_orgs', orgId);
  return { name: String(o?.name ?? COMPANY_NAME), phone: (o?.phone as string) ?? null, email: (o?.email as string) ?? null, license_no: (o?.license_no as string) ?? null, address: (o?.address as string) ?? null };
}
async function siteInfo(siteId: string) {
  const s = await getRecord<Row>('patrol_sites', siteId);
  return { name: String(s?.name ?? 'Site'), address: [s?.address, s?.city, s?.state].filter(Boolean).join(', ') || null };
}

/** Photo bytes for attachments: local compressed blob first, then a signed URL. */
async function photoBytes(atts: Row[]): Promise<PdfPhoto[]> {
  const out: PdfPhoto[] = [];
  const images = atts.filter((a) => a.kind === 'image').slice(0, 12);
  const remote: Row[] = [];
  for (const a of images) {
    const b = await (await db()).get('blobs', a.id);
    if (b) out.push({ bytes: new Uint8Array(b.bytes), mime: b.mime, caption: `Photo ${out.length + 1} · ${timeLabel(a.client_created_at ?? a.created_at)}` });
    else remote.push(a);
  }
  if (remote.length) {
    try {
      const urls = await getBackend().storage.signedUrls(remote.map((a) => a.storage_path as string), 600);
      for (const a of remote) {
        const u = urls[a.storage_path as string];
        if (!u || u.startsWith('data:,')) continue;
        try { const r = await fetch(u); if (r.ok) out.push({ bytes: new Uint8Array(await r.arrayBuffer()), mime: String(a.mime), caption: `Photo ${out.length + 1} · ${timeLabel(a.client_created_at ?? a.created_at)}` }); } catch { /* skip */ }
      }
    } catch { /* offline */ }
  }
  return out;
}
const mediaLabel = (a: Row) => `${({ video: 'Video', audio: 'Audio file', voice_note: 'Voice note', document: 'PDF document' } as Record<string, string>)[String(a.kind)] ?? 'File'}${a.duration_s ? ` · ${Math.round(Number(a.duration_s))}s` : ''} · ${timeLabel(a.client_created_at ?? a.created_at)}`;

const STATUS_LABEL: Record<string, string> = { submitted: 'Submitted', reviewed: 'Reviewed', sent_to_client: 'Sent to client', closed: 'Closed' };

export async function incidentPdf(id: string, opts: { includeInternal: boolean }) {
  const inc = await getRecord<Row>('patrol_incidents', id);
  if (!inc) throw new Error('Report not found on this device.');
  if (opts.includeInternal) {
    try {
      const b = getBackend();
      await putServerRows('patrol_attachments', await b.select<Row>('patrol_attachments', { eq: { parent_id: id } }));
      await putServerRows('patrol_incident_events', await b.select<Row>('patrol_incident_events', { eq: { incident_id: id } }));
    } catch { /* offline: cached */ }
  }
  const atts = await listByParent<Row>('patrol_attachments', id);
  const events = (await listByParent<Row>('patrol_incident_events', id))
    .filter((e) => opts.includeInternal || e.kind === 'status')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((e) => ({ at: String(e.created_at), actor: String(e.actor_name ?? ''), text: e.kind === 'status' ? `Status > ${STATUS_LABEL[String(e.to_status)] ?? e.to_status}` : `${e.kind === 'note' ? 'Internal note' : 'Addendum'}: ${e.body ?? ''}` }));
  if (inc.submitted_at) events.unshift({ at: String(inc.submitted_at), actor: String(inc.author_name ?? ''), text: 'Submitted' });
  const cat = inc.category_id ? await getRecord<Row & { name: string; field_config?: FieldConfig | null }>('patrol_categories', String(inc.category_id)) : undefined;
  const { buildIncidentPdf } = await import('./report');
  const r = await buildIncidentPdf({
    extras: extraDetails(inc, cat ?? null),
    org: await orgInfo(String(inc.org_id)), site: await siteInfo(String(inc.site_id)), logoPng: await logo(),
    incident: opts.includeInternal ? inc : { ...inc, review_notes: null }, includeInternal: opts.includeInternal,
    photos: await photoBytes(atts), otherMedia: atts.filter((a) => a.kind !== 'image').map(mediaLabel), events,
  });
  return { ...r, filename: `${String(inc.report_no ?? 'Incident').replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
}

export async function darPdf(id: string) {
  const dar = await getRecord<Row>('patrol_dars', id);
  if (!dar) throw new Error('Daily report not found on this device.');
  const b = getBackend();
  let entries = await listByParent<Row>('patrol_dar_entries', id);
  try { const fresh = await b.select<Row>('patrol_dar_entries', { eq: { dar_id: id } }); if (fresh.length) { await putServerRows('patrol_dar_entries', fresh); entries = await listByParent<Row>('patrol_dar_entries', id); } } catch { /* offline */ }
  entries = entries.filter((e) => !e.deleted_at).sort((a, z) => String(a.occurred_at).localeCompare(String(z.occurred_at)));
  const te = dar.time_entry_id ? await getRecord<Row>('patrol_time_entries', String(dar.time_entry_id)) : undefined;
  const org = String(dar.org_id);
  const [runsAll, scansAll, cps, incAll] = await Promise.all([listRecords<Row>('patrol_tour_runs', org), listRecords<Row>('patrol_scans', org), listRecords<Row>('patrol_checkpoints', org), listRecords<Row>('patrol_incidents', org)]);
  const start = te?.clock_in_at ? Date.parse(String(te.clock_in_at)) : Date.parse(`${dar.report_date}T12:00:00Z`) - 6 * 3600e3;
  const end = te?.clock_out_at ? Date.parse(String(te.clock_out_at)) : start + 14 * 3600e3;
  const inShift = (iso: unknown) => { const t = Date.parse(String(iso)); return t >= start - 60e3 && t <= end + 60e3; };
  const runs = runsAll.filter((r) => r.site_id === dar.site_id && (dar.time_entry_id ? r.time_entry_id === dar.time_entry_id : inShift(r.started_at))).sort((a, z) => String(a.started_at).localeCompare(String(z.started_at)));
  const siteCps = cps.filter((c) => c.site_id === dar.site_id && c.active !== false).sort((a, z) => Number(a.seq) - Number(z.seq));
  const tours = runs.map((r) => {
    const scans = scansAll.filter((s) => s.tour_run_id === r.id).sort((a, z) => String(a.scanned_at).localeCompare(String(z.scanned_at)));
    const done = new Set(scans.map((s) => s.checkpoint_id));
    const finished = !!r.completed_at || Date.now() - Date.parse(String(r.started_at)) > 3600e3;
    return {
      started: String(r.started_at), completed: (r.completed_at as string) ?? null, expected: Number(r.expected_count ?? siteCps.length), scanned: Number(r.scanned_count ?? done.size),
      scans: scans.map((s) => ({ at: String(s.scanned_at), checkpoint: String(cps.find((c) => c.id === s.checkpoint_id)?.name ?? 'Checkpoint'), flags: (s.flags as string[]) ?? [] })),
      missed: finished ? siteCps.filter((c) => !done.has(c.id)).map((c) => String(c.name)) : [],
    };
  });
  const incidents = incAll.filter((i) => i.status !== 'draft' && i.site_id === dar.site_id && (dar.time_entry_id && i.time_entry_id ? i.time_entry_id === dar.time_entry_id : inShift(i.occurred_at)))
    .map((i) => ({ report_no: (i.report_no as string) ?? null, title: String(i.title || i.category_name || 'Incident'), at: String(i.occurred_at), severity: String(i.severity), status: String(i.status) }));
  const photoAtts: Row[] = [];
  for (const e of entries) photoAtts.push(...(await listByParent<Row>('patrol_attachments', e.id)));
  const { buildDarPdf } = await import('./report');
  const r = await buildDarPdf({
    org: await orgInfo(org), site: await siteInfo(String(dar.site_id)), logoPng: await logo(),
    dar: { report_no: (dar.report_no as string) ?? null, report_date: String(dar.report_date), status: String(dar.status), author_name: String(dar.author_name ?? ''), summary: (dar.summary as string) ?? null, submitted_at: (dar.submitted_at as string) ?? null },
    shift: te ? { clock_in: te.clock_in_at as string, clock_out: (te.clock_out_at as string) ?? null, note: (te.shift_note as string) ?? null } : null,
    entries: entries.map((e) => ({ at: String(e.occurred_at), category: (e.category_name as string) ?? null, body: String(e.body) })),
    tours, incidents, photos: await photoBytes(photoAtts),
  });
  return { ...r, filename: `DAR-${String(dar.report_no ?? dar.report_date).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
}

// ---------------------------------------------------------------- end-of-shift PDF (item 12)
const gps = (lat: unknown, lng: unknown, acc?: unknown) => (lat != null && lng != null ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}${acc != null ? ` (±${Math.round(Number(acc))} m)` : ''}` : null);

/** False only when the server answers but doesn't know parent type 'shift' yet (migration 20261029000200 not applied). */
async function shiftParentSupported(): Promise<boolean> {
  try { await getBackend().select('patrol_attachments', { eq: { parent_type: 'shift' }, limit: 1, columns: 'id' }); return true; } catch (e) { return isNetworkError(e); }
}

/** The shift's saved PDF (bytes), if the guard's device uploaded one. */
async function savedShiftPdf(teId: string): Promise<Uint8Array | null> {
  let atts = (await listByParent<Row>('patrol_attachments', teId)).filter((a) => a.parent_type === 'shift' && a.kind === 'document');
  if (!atts.length) {
    try { const rows = await getBackend().select<Row>('patrol_attachments', { eq: { parent_id: teId } }); await putServerRows('patrol_attachments', rows); atts = rows.filter((a) => a.parent_type === 'shift'); } catch { /* offline */ }
  }
  const a = atts.sort((x, y) => String(y.created_at ?? y.client_created_at).localeCompare(String(x.created_at ?? x.client_created_at)))[0];
  if (!a) return null;
  const blob = await (await db()).get('blobs', a.id);
  if (blob) return new Uint8Array(blob.bytes);
  try {
    const url = (await getBackend().storage.signedUrls([String(a.storage_path)], 600))[String(a.storage_path)];
    if (!url || url.startsWith('data:,')) return null;
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { return null; }
}

/**
 * One PDF for a guard's shift: clock in/out + GPS, patrol starts/ends, checkpoint scans, log
 * entries, incidents (with photos and category details) and BOLOs posted. `save` stores it on the
 * shift (patrol_attachments parent 'shift') so owners can open it later; `preferSaved` returns the
 * stored copy when there is one.
 */
export async function endOfShiftPdf(teId: string, opts: { save?: boolean; preferSaved?: boolean } = {}) {
  const te = await getRecord<Row>('patrol_time_entries', teId);
  if (!te) throw new Error('Shift not found on this device.');
  const filename = `Shift-${String(te.clock_in_at).slice(0, 10)}-${teId.slice(-6)}.pdf`;
  if (opts.preferSaved) {
    const saved = await savedShiftPdf(teId);
    if (saved) {
      let pages = 1;
      try { const { PDFDocument } = await import('pdf-lib'); pages = (await PDFDocument.load(saved)).getPageCount(); } catch { /* keep 1 */ }
      return { bytes: saved, pages, filename };
    }
  }
  const org = String(te.org_id);
  const start = Date.parse(String(te.clock_in_at));
  const end = te.clock_out_at ? Date.parse(String(te.clock_out_at)) : Date.now();
  const inShift = (iso: unknown) => { const t = Date.parse(String(iso)); return t >= start - 60e3 && t <= end + 60e3; };
  const [members, dars, entriesAll, scansAll, runsAll, cps, incAll, bolosAll] = await Promise.all([
    listRecords<Row>('patrol_members', org), listRecords<Row>('patrol_dars', org), listRecords<Row>('patrol_dar_entries', org), listRecords<Row>('patrol_scans', org),
    listRecords<Row>('patrol_tour_runs', org), listRecords<Row>('patrol_checkpoints', org), listRecords<Row>('patrol_incidents', org), listRecords<Row>('patrol_bolos', org),
  ]);
  const dar = dars.find((d) => d.time_entry_id === teId);
  const entries = entriesAll.filter((e) => !e.deleted_at && (dar ? e.dar_id === dar.id : e.member_id === te.member_id && inShift(e.occurred_at)));
  const scans = scansAll.filter((x) => x.time_entry_id === teId);
  const runs = runsAll.filter((r) => r.time_entry_id === teId);
  const incidents = incAll.filter((i) => i.status !== 'draft' && i.member_id === te.member_id && (i.time_entry_id ? i.time_entry_id === teId : inShift(i.occurred_at)));
  const bolos = bolosAll.filter((b) => b.created_by === te.member_id && b.site_id === te.site_id && inShift(b.created_at));
  const officer = String(members.find((m) => m.id === te.member_id)?.display_name ?? dar?.author_name ?? 'Officer');
  const cats = await listRecords<Row & { name: string; field_config?: FieldConfig | null }>('patrol_categories', org);
  const timeline = [
    { at: String(te.clock_in_at), kind: 'Clock in', text: gps(te.clock_in_lat, te.clock_in_lng, te.clock_in_accuracy_m) ?? 'No GPS' },
    ...entries.map((e) => ({ at: String(e.occurred_at), kind: /^Patrol (started|ended)/.test(String(e.body)) ? 'Patrol' : String(e.category_name ?? 'Log'), text: String(e.body) })),
    ...scans.map((x) => ({ at: String(x.scanned_at), kind: 'Checkpoint', text: `${cps.find((c) => c.id === x.checkpoint_id)?.name ?? 'Checkpoint'}${(x.flags as string[] ?? []).length ? ` (${(x.flags as string[]).join(', ').replace(/_/g, ' ')})` : ''}` })),
    ...incidents.map((i) => ({ at: String(i.occurred_at), kind: 'Incident', text: `${i.report_no ? `${i.report_no} · ` : ''}${i.title || i.category_name || 'Incident'}` })),
    ...bolos.map((b) => ({ at: String(b.created_at), kind: 'BOLO', text: String(b.title) })),
    ...(te.clock_out_at ? [{ at: String(te.clock_out_at), kind: 'Clock out', text: gps(te.clock_out_lat, te.clock_out_lng, te.clock_out_accuracy_m) ?? 'No GPS' }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const incOut = [];
  for (const i of incidents) {
    if (!(await listByParent<Row>('patrol_attachments', i.id)).length) { try { await putServerRows('patrol_attachments', await getBackend().select<Row>('patrol_attachments', { eq: { parent_id: i.id } })); } catch { /* offline */ } }
    incOut.push({ report_no: (i.report_no as string) ?? null, title: String(i.title || i.category_name || 'Incident'), at: String(i.occurred_at), severity: String(i.severity), category: (i.category_name as string) ?? null,
      description: String(i.description ?? ''), extras: extraDetails(i, cats.find((c) => c.id === i.category_id) ?? null), photos: await photoBytes(await listByParent<Row>('patrol_attachments', i.id)) });
  }
  const logAtts: Row[] = [];
  for (const e of entries) logAtts.push(...(await listByParent<Row>('patrol_attachments', e.id)));
  const confirmed = te.confirmed_at ? `Confirmed by officer${te.confirmed_minutes != null ? ` (${Math.floor(Number(te.confirmed_minutes) / 60)}h ${String(Number(te.confirmed_minutes) % 60).padStart(2, '0')}m)` : ''}` : te.timesheet_note ? `Flagged: ${te.timesheet_note}` : null;
  const { buildShiftPdf } = await import('./report');
  const r = await buildShiftPdf({
    org: await orgInfo(org), site: await siteInfo(String(te.site_id)), logoPng: await logo(), officer,
    shift: { clock_in: String(te.clock_in_at), clock_out: (te.clock_out_at as string) ?? null, in_gps: gps(te.clock_in_lat, te.clock_in_lng, te.clock_in_accuracy_m), out_gps: gps(te.clock_out_lat, te.clock_out_lng, te.clock_out_accuracy_m), note: (te.shift_note as string) ?? null, timesheet: confirmed },
    timeline, stats: { patrols: Math.max(runs.length, entries.filter((e) => /^Patrol started/.test(String(e.body))).length), scans: scans.length, entries: entries.length, incidents: incidents.length, bolos: bolos.length },
    incidents: incOut, bolos: bolos.map((b) => ({ title: String(b.title), at: String(b.created_at), description: [b.description, b.person_desc && `Person: ${b.person_desc}`, b.vehicle_desc && `Vehicle: ${b.vehicle_desc}`].filter(Boolean).join(' · ') })),
    photos: await photoBytes(logAtts),
  });
  if (opts.save && (await shiftParentSupported())) {
    const { addAttachment } = await import('../data/guard');
    const bytes = r.bytes.slice().buffer as ArrayBuffer;
    await addAttachment('shift', teId, { kind: 'document', mime: 'application/pdf', ext: 'pdf', bytes, thumb: null, name: filename }).catch(() => undefined);
  }
  return { ...r, filename };
}

export { buildFromPortal } from './portal';
