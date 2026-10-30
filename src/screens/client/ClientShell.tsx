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
import { PortalView } from './PortalView';
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
  // Item 7: the whole client app uses the light, client-facing theme.
  if (p === '/c/more') return <div class="client-theme"><MoreScreen base="/c" /></div>;
  if (p === '/c/more/sync') return <div class="client-theme"><SyncScreen base="/c" /></div>;
  if ((m = match('/c/incidents/:id', p))) return <div class="client-theme"><ClientIncident id={m.id!} /></div>;
  if ((m = match('/c/dars/:id', p))) return <div class="client-theme"><ClientDar id={m.id!} /></div>;
  return <ClientHome ready={ready} />;
}

function ClientHome({ ready }: { ready: boolean }) {
  const org = currentOrgId.value;
  const sites = useData(() => sitesFor(org, memberId.value, false), [org]);
  const mySites = new Set((sites.data ?? []).map((s) => s.id));
  const incidents = useData(() => listRecords<R>('patrol_incidents', org), [org]);
  const dars = useData(() => listRecords<R>('patrol_dars', org), [org]);
  const runs = useData(() => listRecords<R>('patrol_tour_runs', org), [org]);
  const orgRow = useData(() => getRecord<R>('patrol_orgs', org ?? ''), [org]);
  // Client-visible BOLOs for the client's sites (clients can't read patrol_bolos directly).
  const [bolos, setBolos] = useState<R[]>([]);
  useEffect(() => { void getBackend().rpc<R[] | null>('patrol_client_bolos').then((r) => setBolos(r ?? [])).catch(() => setBolos([])); }, [org]);
  const inc = (incidents.data ?? []).filter((i) => i.client_visible && i.status !== 'draft' && mySites.has(i.site_id as string));
  const dar = (dars.data ?? []).filter((d) => d.client_visible && mySites.has(d.site_id as string));
  const myRuns = (runs.data ?? []).filter((r) => mySites.has(r.site_id as string));
  const list = sites.data ?? [];
  const site = list[0];
  if (!ready && !inc.length && !list.length) return <div class="client-theme cp"><div class="cp-inner"><SkeletonList rows={3} /></div></div>;
  return (
    <PortalView kind="client" openIncident={(id) => navigate(`/c/incidents/${id}`)} openDar={(id) => navigate(`/c/dars/${id}`)}
      incidentPdf={(id) => () => import('../../pdf').then((m) => m.incidentPdf(id, { includeInternal: false }))}
      darPdf={(id) => () => import('../../pdf').then((m) => m.darPdf(id))}
      headerRight={<span class="row" style={{ gap: 4 }}><Button variant="ghost" icon="more" aria-label="More" onClick={() => navigate('/c/more')} /><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button></span>}
      m={{ orgName: orgName.value || String(orgRow.data?.name ?? 'Lion Security Services'), orgPhone: (orgRow.data?.phone as string) ?? null, orgEmail: (orgRow.data?.email as string) ?? null,
        siteName: list.length > 1 ? list.map((s) => s.name).join(' · ') : site?.name ?? 'Your site', siteAddress: list.length === 1 ? [site?.address, site?.city].filter(Boolean).join(', ') : undefined,
        incidents: inc, dars: dar, runs: myRuns, bolos }} />
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
