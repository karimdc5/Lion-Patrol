import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, Empty, SkeletonList, Button } from '../../ui/kit';
import { getBackend, currentOrgId, memberId, signOut, orgName } from '../../auth/session';
import { useData } from '../../ui/useData';
import { sitesFor } from '../../data/repos/queries';
import { putServerRows, listRecords, getRecord, scopeOf } from '../../data/repos/records';
import type { SelectQuery } from '../../data/backend/types';
import { fmtDateTime, fmtDate, fmtTime } from '../../lib/format';
import type { Row as R } from '../../data/db';
import { path, match, navigate } from '../../router';
import { MoreScreen } from '../shared/More';
import { PdfButton } from '../../ui/PdfButton';
import { SyncScreen } from '../shared/Sync';
import { BoloCard, type BoloView } from '../../ui/BoloCard';
import { RemotePhotos, type RemotePhoto } from '../../ui/RemotePhotos';
import { extraDetails, type FieldConfig } from '../../domain/incident';

async function refreshClient() {
  const b = getBackend();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const org = currentOrgId.value;
  const jobs: Array<[string, SelectQuery]> = [
    ['patrol_incidents', { eq: { org_id: org ?? '' }, order: ['occurred_at', 'desc'], limit: 100 }],
    ['patrol_dars', { eq: { org_id: org ?? '' }, order: ['report_date', 'desc'], limit: 60 }],
    ['patrol_tour_runs', { eq: { org_id: org ?? '' }, gte: { started_at: since }, order: ['started_at', 'desc'], limit: 400 }],
  ];
  await Promise.all(jobs.map(async ([t, q]) => {
    const startedAt = Date.now();
    const rows = await b.select<R>(t, q);
    await putServerRows(t, rows, { scope: scopeOf(q, rows, startedAt) });
  }).map((p) => p.catch(() => undefined)));
}

export default function ClientShell() {
  const p = path.value;
  const [ready, setReady] = useState(false);
  useEffect(() => { void refreshClient().finally(() => setReady(true)); }, [currentOrgId.value]);
  let m: Record<string, string> | null;
  if (p === '/c/more') return <MoreScreen base="/c" />;
  if (p === '/c/more/sync') return <SyncScreen base="/c" />;
  if ((m = match('/c/incidents/:id', p))) return <ClientIncident id={m.id!} />;
  if ((m = match('/c/dars/:id', p))) return <ClientDar id={m.id!} />;
  return <ClientHome ready={ready} />;
}

function ClientHome({ ready }: { ready: boolean }) {
  const org = currentOrgId.value;
  const sites = useData(() => sitesFor(org, memberId.value, false), [org]);
  const mySites = new Set((sites.data ?? []).map((s) => s.id));
  const incidents = useData(() => listRecords<R>('patrol_incidents', org), [org]);
  const dars = useData(() => listRecords<R>('patrol_dars', org), [org]);
  const runs = useData(() => listRecords<R>('patrol_tour_runs', org), [org]);
  // Client-visible BOLOs for the client's sites (clients can't read patrol_bolos directly).
  const bolos = useData(() => getBackend().rpc<R[]>('patrol_client_bolos').catch(() => [] as R[]), [org]);
  const inc = (incidents.data ?? []).filter((i) => i.client_visible && i.status !== 'draft' && mySites.has(i.site_id as string)).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  const dar = (dars.data ?? []).filter((d) => d.client_visible && mySites.has(d.site_id as string)).sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
  const myRuns = (runs.data ?? []).filter((r) => mySites.has(r.site_id as string));
  const perDay = days.map((d) => {
    const end = d.getTime() + 864e5;
    // overnight shifts: count runs started from noon the previous day
    const rs = myRuns.filter((r) => { const t = Date.parse(r.started_at as string); return t >= d.getTime() - 12 * 3600e3 && t < end - 12 * 3600e3; });
    const exp = rs.reduce((n, r) => n + Number(r.expected_count ?? 0), 0);
    const got = rs.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0);
    return { d, runs: rs.length, pct: exp ? Math.round((got / exp) * 100) : null };
  });
  const site = sites.data?.[0];
  return (
    <Screen>
      <TopBar title={sites.data && sites.data.length > 1 ? 'Your sites' : site?.name ?? 'Your site'} large sub={`Security reports from ${orgName.value || 'Lion Security Services'}`} right={<Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>} />
      <div class="screen-body stack-lg" data-testid="client-home">
        {(bolos.data ?? []).length > 0 && (
          <div data-testid="client-bolos">
            <SectionLabel>Be on the lookout</SectionLabel>
            <div class="stack">{bolos.data!.map((b) => <BoloCard key={String(b.id)} b={b as unknown as BoloView}><RemotePhotos photos={(b.photos as RemotePhoto[] | undefined) ?? []} /></BoloCard>)}</div>
          </div>
        )}
        <div>
          <SectionLabel>Patrol proof · last 7 nights</SectionLabel>
          <div class="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, alignItems: 'end', height: 120 }} aria-label="Patrol completion by day">
              {perDay.map((x) => (
                <div key={x.d.toISOString()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <span class="foot tnum" style={{ color: x.pct == null ? 'var(--text-3)' : 'var(--text)' }}>{x.pct == null ? '—' : `${x.pct}%`}</span>
                  <span style={{ width: '70%', borderRadius: 6, height: `${Math.max(4, (x.pct ?? 0) * 0.7)}px`, background: x.pct == null ? 'var(--raised-2)' : x.pct < 80 ? 'var(--warning)' : 'var(--success)' }} />
                  <span class="foot muted">{x.d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                </div>
              ))}
            </div>
            <p class="foot muted" style={{ marginTop: 10 }}>{myRuns.length} patrol tours logged with timestamped QR checkpoint scans.</p>
          </div>
        </div>
        <div>
          <SectionLabel>Incident reports</SectionLabel>
          {!ready && !inc.length ? <SkeletonList rows={2} /> : inc.length ? (
            <List>{inc.map((i) => <Row key={i.id} testid="client-incident" icon="file" title={String(i.title || i.category_name)} sub={`${i.report_no ?? ''} · ${fmtDateTime(i.occurred_at as string)}`} chevron href={`/c/incidents/${i.id}`} />)}</List>
          ) : <Empty icon="file" title="No reports shared yet" body="Incident reports appear here once Lion Security Services shares them with you." />}
        </div>
        <div>
          <SectionLabel>Daily activity reports</SectionLabel>
          {dar.length ? (
            <List>{dar.map((d) => <Row key={d.id} testid="client-dar" icon="activity" title={`Daily report · ${fmtDate(String(d.report_date) + 'T12:00:00Z')}`} sub={`${d.author_name} · ${d.report_no ?? ''}`} chevron href={`/c/dars/${d.id}`} />)}</List>
          ) : <Empty icon="activity" title="No daily reports shared yet" />}
        </div>
      </div>
    </Screen>
  );
}

function ClientIncident({ id }: { id: string }) {
  const i = useData(() => getRecord<R>('patrol_incidents', id), [id]);
  const extras = useData(async () => (i.data ? extraDetails(i.data, i.data.category_id ? (await getRecord<R & { name: string; field_config?: FieldConfig | null }>('patrol_categories', String(i.data.category_id))) ?? null : null) : []), [i.data?.id]);
  if (!i.data) return <Screen><TopBar title="Report" backTo="/c" /><div class="screen-body"><Empty icon="file" title="Report not found" /></div></Screen>;
  const x = i.data;
  return (
    <Screen>
      <TopBar title={String(x.report_no ?? 'Report')} backTo="/c" />
      <div class="screen-body stack-lg">
        <div><h1 class="title">{String(x.title || x.category_name)}</h1><div class="muted sub">{String(x.category_name ?? '')}{x.subtype_name ? ` › ${x.subtype_name}` : ''}</div></div>
        <div class="card kv">
          <div><span>Occurred</span>{fmtDateTime(x.occurred_at as string)}</div>
          <div><span>Officer</span>{String(x.author_name)}</div>
          <div><span>Police</span>{x.police_called ? `${x.police_agency ?? 'Yes'}${x.police_case_no ? ` · ${x.police_case_no}` : ''}` : 'Not contacted'}</div>
          <div><span>Severity</span>{String(x.severity)}</div>
        </div>
        {extras.data && extras.data.length > 0 && <div data-testid="client-extra"><SectionLabel>{String(x.category_name ?? 'Category')} details</SectionLabel><div class="card kv">{extras.data.map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div></div>}
        <div><SectionLabel>Narrative</SectionLabel><div class="card" style={{ whiteSpace: 'pre-wrap', lineHeight: '24px' }}>{String(x.description)}</div></div>
        <PdfButton block variant="primary" label="Download PDF report" testid="client-incident-pdf" make={() => import('../../pdf').then((m) => m.incidentPdf(x.id, { includeInternal: false }))} />
      </div>
    </Screen>
  );
}

function ClientDar({ id }: { id: string }) {
  const d = useData(() => getRecord<R>('patrol_dars', id), [id]);
  const [entries, setEntries] = useState<R[]>([]);
  useEffect(() => { void getBackend().select<R>('patrol_dar_entries', { eq: { dar_id: id }, order: ['occurred_at', 'asc'] }).then(setEntries).catch(() => undefined); }, [id]);
  if (!d.data) return <Screen><TopBar title="Daily report" backTo="/c" /><div class="screen-body" /></Screen>;
  return (
    <Screen>
      <TopBar title={String(d.data.report_no ?? 'Daily report')} backTo="/c" />
      <div class="screen-body stack-lg">
        <div><h1 class="title">Daily activity · {fmtDate(String(d.data.report_date) + 'T12:00:00Z')}</h1><div class="muted sub">{String(d.data.author_name)}</div></div>
        {d.data.summary ? <div class="card">{String(d.data.summary)}</div> : null}
        <PdfButton block variant="primary" label="Download PDF report" testid="client-dar-pdf" make={() => import('../../pdf').then((m) => m.darPdf(id))} />
        <div class="card" style={{ padding: '6px 14px' }}>
          {entries.filter((e) => !e.deleted_at).map((e) => (
            <div class="tl-item" key={e.id}><div class="tl-time">{fmtTime(e.occurred_at as string)}</div><div class="tl-dot" style={{ background: 'var(--gold)' }} /><div class="tl-body"><div class="tl-title">{String(e.category_name ?? 'Log')}</div><div class="tl-sub" style={{ WebkitLineClamp: 6 }}>{String(e.body)}</div></div></div>
          ))}
          {!entries.length && <p class="muted sub" style={{ padding: 10 }}>No entries.</p>}
        </div>
      </div>
    </Screen>
  );
}

export { navigate };
