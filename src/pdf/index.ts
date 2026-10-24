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
import type { OrgInfo, PdfPhoto } from './report';

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
  const { buildIncidentPdf } = await import('./report');
  const r = await buildIncidentPdf({
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

export { buildFromPortal } from './portal';
