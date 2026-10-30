import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, Empty, SkeletonList, Button, Field, Toggle, toast, SectionLabel } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, getBackend } from '../../auth/session';
import { listRecords, getRecord, listByParent } from '../../data/repos/records';
import { setIncidentStatus, setIncidentClientVisible, addIncidentNote, fetchIncidentExtras } from '../../data/admin';
import { fmtDateTime, relTime } from '../../lib/format';
import { db, type Row as R } from '../../data/db';
import { labelFor } from '../../data/guard';
import { PdfButton } from '../../ui/PdfButton';
import { extraDetails, type FieldConfig } from '../../domain/incident';

const STATUS: Record<string, [string, string]> = {
  submitted: ['New', 'pill-warning'], reviewed: ['Reviewed', 'pill-info'], sent_to_client: ['Sent to client', 'pill-success'], closed: ['Closed', 'pill-muted'], draft: ['Draft', 'pill-muted'],
};
const SEV: Record<string, string> = { low: 'pill-muted', medium: 'pill-warning', high: 'pill-danger', critical: 'pill-danger' };
export const StatusPill = ({ s }: { s: string }) => <span class={`pill ${STATUS[s]?.[1] ?? 'pill-muted'}`}>{STATUS[s]?.[0] ?? s}</span>;

export function IncidentsList() {
  const org = currentOrgId.value;
  const [tab, setTab] = useState('submitted');
  const list = useData(() => listRecords<R>('patrol_incidents', org), [org]);
  const rows = (list.data ?? []).filter((i) => i.status !== 'draft' && (tab === 'all' || i.status === tab)).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  return (
    <Screen tabbar>
      <TopBar title="Incidents" large right={<SyncPill />} />
      <div class="screen-body stack">
        <div class="tabs" role="tablist">
          {[['submitted', 'New'], ['reviewed', 'Reviewed'], ['sent_to_client', 'Sent'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => (
            <button key={k} class={tab === k ? 'active' : ''} onClick={() => setTab(k!)} role="tab" aria-selected={tab === k}>{l} {k !== 'all' && <span class="tnum" style={{ opacity: 0.7 }}>{(list.data ?? []).filter((i) => i.status === k).length}</span>}</button>
          ))}
        </div>
        {list.loading ? <SkeletonList /> : rows.length ? (
          <List>
            {rows.map((i) => <Row key={i.id} testid="incident-row" icon="alert" iconBg={i.severity === 'high' || i.severity === 'critical' ? 'var(--danger-soft)' : 'var(--raised-2)'} iconColor={i.severity === 'high' || i.severity === 'critical' ? 'var(--danger)' : 'var(--text-2)'}
              title={String(i.title || i.category_name || 'Incident')} sub={`${i.author_name} · ${relTime(i.occurred_at as string)}${i.report_no ? ` · ${i.report_no}` : ''}`} right={<StatusPill s={String(i.status)} />} chevron href={`/a/incidents/${i.id}`} />)}
          </List>
        ) : <Empty icon="file" title="No incidents here" body="Submitted reports appear in New for review." />}
      </div>
    </Screen>
  );
}

function AttachmentLink({ a }: { a: R }) {
  const [url, setUrl] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let local: string | null = null;
    void (async () => {
      const blob = await (await db()).get('blobs', a.id);
      if (blob) { local = URL.createObjectURL(new Blob([blob.bytes], { type: blob.mime })); setUrl(local); setThumb(local); return; }
      try {
        const paths = [a.storage_path as string, ...(a.thumb_path ? [a.thumb_path as string] : [])];
        const urls = await getBackend().storage.signedUrls(paths, 3600);
        setUrl(urls[a.storage_path as string] ?? null);
        setThumb(a.thumb_path ? urls[a.thumb_path as string] ?? null : a.kind === 'image' ? urls[a.storage_path as string] ?? null : null);
      } catch { /* offline */ }
    })();
    return () => { if (local) URL.revokeObjectURL(local); };
  }, [a.id]);
  const isImg = a.kind === 'image' && thumb && !thumb.startsWith('data:,');
  return (
    <a class="att" href={url ?? undefined} target="_blank" rel="noopener" data-testid="review-attachment" style={{ width: 96, height: 96 }}>
      {isImg ? <img src={thumb!} alt="" /> : <Icon name={a.kind === 'document' ? 'file' : a.kind === 'video' ? 'camera' : a.kind === 'image' ? 'camera' : 'mic'} size={28} />}
      <span class="att-badge">{labelFor(String(a.kind))}</span>
    </a>
  );
}

export function IncidentReview({ id }: { id: string }) {
  const org = currentOrgId.value;
  const inc = useData(() => getRecord<R>('patrol_incidents', id), [id]);
  const atts = useData(() => listByParent<R>('patrol_attachments', id), [id]);
  const events = useData(() => listByParent<R>('patrol_incident_events', id), [id]);
  const site = useData(async () => (inc.data ? getRecord<R>('patrol_sites', inc.data.site_id as string) : undefined), [inc.data?.site_id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetchIncidentExtras(id); }, [id]);
  void org;
  const i = inc.data;
  if (!i) return <Screen><TopBar title="Incident" backTo="/a/incidents" /><div class="screen-body"><SkeletonList rows={3} /></div></Screen>;
  const people = (i.people as Array<Record<string, string>>) ?? [];
  const vehicles = (i.vehicles as Array<Record<string, string>>) ?? [];
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast(msg); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } };
  return (
    <Screen>
      <TopBar title={String(i.report_no ?? 'Incident')} backTo="/a/incidents" right={<SyncPill />} />
      <div class="screen-body stack-lg" data-testid="incident-review">
        <div class="stack" style={{ gap: 8 }}>
          <div class="row" style={{ gap: 6, flexWrap: 'wrap' }}><StatusPill s={String(i.status)} /><span class={`pill ${SEV[String(i.severity)]}`}>{String(i.severity)}</span>{i.client_visible ? <span class="pill pill-success"><Icon name="eye" size={14} /> Client can see</span> : <span class="pill pill-muted"><Icon name="eye-off" size={14} /> Internal</span>}</div>
          <h1 class="title">{String(i.title || i.category_name)}</h1>
          <div class="muted sub">{String(i.category_name ?? '')}{i.subtype_name ? ` › ${i.subtype_name}` : ''}</div>
        </div>
        <div class="card kv">
          <div><span>Site</span>{String(site.data?.name ?? '—')}</div>
          <div><span>Occurred</span>{fmtDateTime(i.occurred_at as string)}</div>
          <div><span>Reported by</span>{String(i.author_name)}</div>
          <div><span>Location</span>{String(i.location_text ?? (i.lat != null ? `${Number(i.lat).toFixed(5)}, ${Number(i.lng).toFixed(5)}` : '—'))}</div>
          <div><span>Police</span>{i.police_called ? `${i.police_agency ?? 'Yes'} · ${i.police_case_no ?? 'no case #'}` : 'Not contacted'}</div>
          <div><span>Fire / EMS</span>{[i.fire_called && 'Fire', i.ems_called && 'EMS'].filter(Boolean).join(', ') || 'No'}</div>
          {i.property_damage ? <div><span>Damage est.</span>${String(i.damage_estimate_usd ?? '—')}</div> : null}
          {i.injury ? <div><span>Injury</span>{String(i.injury_details ?? 'Yes')}</div> : null}
        </div>
        <ExtraDetails i={i} />
        <div><SectionLabel>What happened</SectionLabel><div class="card" style={{ whiteSpace: 'pre-wrap', lineHeight: '24px' }}>{String(i.description)}</div></div>
        {people.length > 0 && <div><SectionLabel>People</SectionLabel><List>{people.map((p, k) => <Row key={k} icon="user" title={p.name || 'Unknown'} sub={[p.role, p.description, p.phone].filter(Boolean).join(' · ')} />)}</List></div>}
        {vehicles.length > 0 && <div><SectionLabel>Vehicles</SectionLabel><List>{vehicles.map((v, k) => <Row key={k} icon="car" title={`${v.plate || 'No plate'} ${v.state ?? ''}`} sub={[v.color, v.make, v.model].filter(Boolean).join(' ')} />)}</List></div>}
        <div><SectionLabel>Attachments</SectionLabel>{(atts.data ?? []).length ? <div class="att-tray">{atts.data!.map((a) => <AttachmentLink key={a.id} a={a} />)}</div> : <p class="muted sub">No attachments.</p>}</div>

        <div class="grid-2">
          <PdfButton label="Client PDF" testid="incident-pdf-client" make={() => import('../../pdf').then((m) => m.incidentPdf(i.id, { includeInternal: false }))} />
          <PdfButton label="Internal PDF" testid="incident-pdf" make={() => import('../../pdf').then((m) => m.incidentPdf(i.id, { includeInternal: true }))} />
        </div>
        <div class="card stack">
          <div class="headline">Review</div>
          <div class="foot muted">Status</div>
          <div class="tabs">
            {(['reviewed', 'sent_to_client', 'closed'] as const).map((s) => (
              <button key={s} class={i.status === s ? 'active' : ''} disabled={busy} data-testid={`status-${s}`} onClick={() => void act(() => setIncidentStatus(i.id, s), `Marked ${STATUS[s]![0].toLowerCase()}`)}>{STATUS[s]![0]}</button>
            ))}
          </div>
          <Field label="Severity">
            <select class="input" value={String(i.severity)} onChange={(e) => void act(() => setIncidentStatus(i.id, i.status === 'submitted' ? 'reviewed' : String(i.status), (e.target as HTMLSelectElement).value), 'Severity updated')}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
          </Field>
          <div class="row-between"><span>Visible to client<div class="foot muted">The site’s client can read this report in their portal.</div></span><Toggle label="Visible to client" checked={!!i.client_visible} onChange={(v) => void act(() => setIncidentClientVisible(i.id, v), v ? 'Shared with client' : 'Hidden from client')} /></div>
          <Field label="Internal note (never shown to the client)">
            <textarea class="input" rows={2} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} data-testid="review-note" />
          </Field>
          <Button disabled={!note.trim() || busy} onClick={() => void act(async () => { await addIncidentNote(i.id, note.trim()); setNote(''); await fetchIncidentExtras(i.id); }, 'Note added')}>Add note</Button>
        </div>
        {(events.data ?? []).length > 0 && (
          <div><SectionLabel>History</SectionLabel><List>{[...events.data!].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((e) => <Row key={e.id} icon={e.kind === 'note' ? 'note' : 'clock'} title={e.kind === 'status' ? `Status → ${STATUS[String(e.to_status)]?.[0] ?? e.to_status}` : String(e.body ?? e.kind)} sub={`${e.actor_name} · ${fmtDateTime(e.created_at as string)}${e.kind === 'status' && e.body ? ` · ${e.body}` : ''}`} />)}</List></div>
        )}
        {i.review_notes ? <div><SectionLabel>Internal notes</SectionLabel><div class="card foot" style={{ whiteSpace: 'pre-wrap' }}>{String(i.review_notes)}</div></div> : null}
      </div>
    </Screen>
  );
}

/** Category-specific answers (incident.extra) with the category's labels. */
function ExtraDetails({ i }: { i: R }) {
  const cat = useData(async () => (i.category_id ? getRecord<R & { name: string; field_config?: FieldConfig | null }>('patrol_categories', String(i.category_id)) : undefined), [i.category_id]);
  const rows = extraDetails(i, cat.data ?? null);
  if (!rows.length) return null;
  return (
    <div data-testid="extra-details"><SectionLabel>{String(i.category_name ?? 'Category')} details</SectionLabel>
      <div class="card kv">{rows.map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div>
    </div>
  );
}
