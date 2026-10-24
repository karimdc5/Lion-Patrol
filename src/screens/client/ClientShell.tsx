import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, Empty, SkeletonList, Button } from '../../ui/kit';
import { getBackend, currentOrgId, memberId, signOut } from '../../auth/session';
import { useData } from '../../ui/useData';
import { sitesFor } from '../../data/repos/queries';
import { putServerRows, listRecords } from '../../data/repos/records';
import { fmtDateTime, fmtDate } from '../../lib/format';
import type { Row as R } from '../../data/db';
import { path } from '../../router';
import { MoreScreen } from '../shared/More';
import { SyncScreen } from '../shared/Sync';

export default function ClientShell() {
  const p = path.value;
  if (p === '/c/more') return <MoreScreen base="/c" />;
  if (p === '/c/more/sync') return <SyncScreen base="/c" />;
  return <ClientHome />;
}

function ClientHome() {
  const org = currentOrgId.value;
  const sites = useData(() => sitesFor(org, memberId.value, false), [org]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const b = getBackend();
    Promise.all([
      b.select<R>('patrol_incidents', { order: ['occurred_at', 'desc'], limit: 50 }).then((r) => putServerRows('patrol_incidents', r)),
      b.select<R>('patrol_dars', { order: ['report_date', 'desc'], limit: 50 }).then((r) => putServerRows('patrol_dars', r)),
    ]).catch(() => undefined).finally(() => setLoaded(true));
  }, [org]);
  const incidents = useData(() => listRecords<R>('patrol_incidents', org), [org]);
  const dars = useData(() => listRecords<R>('patrol_dars', org), [org]);
  const site = sites.data?.[0];
  return (
    <Screen>
      <TopBar title={site?.name ?? 'Your site'} large sub="Reports shared by Lion Security Services" right={<Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>} />
      <div class="screen-body">
        <SectionLabel>Incident reports</SectionLabel>
        {!loaded && !incidents.data?.length ? <SkeletonList rows={2} /> : incidents.data?.length ? (
          <List>{incidents.data.map((i) => <Row key={i.id} icon="file" title={String(i.title)} sub={`${i.report_no ?? ''} · ${fmtDateTime(i.occurred_at as string)}`} />)}</List>
        ) : <Empty icon="file" title="No reports shared yet" />}
        <SectionLabel>Daily activity reports</SectionLabel>
        {dars.data?.length ? (
          <List>{dars.data.map((d) => <Row key={d.id} icon="activity" title={`DAR · ${fmtDate(String(d.report_date) + 'T12:00:00Z')}`} sub={`${d.author_name} · ${d.report_no ?? ''}`} />)}</List>
        ) : <Empty icon="activity" title="No daily reports shared yet" />}
      </div>
    </Screen>
  );
}
