import { Screen, TopBar, SyncPill, List, Row, Empty, SkeletonList } from '../../ui/kit';
import { useEffect, useState } from 'preact/hooks';
import { getBackend, currentOrgId } from '../../auth/session';
import { putServerRows, listRecords } from '../../data/repos/records';
import { useData } from '../../ui/useData';
import { fmtDateTime } from '../../lib/format';
import type { Row as R } from '../../data/db';

export function IncidentsList() {
  const org = currentOrgId.value;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    getBackend().select<R>('patrol_incidents', { eq: { org_id: org ?? '' }, order: ['occurred_at', 'desc'], limit: 100 })
      .then((rows) => putServerRows('patrol_incidents', rows)).catch(() => undefined).finally(() => setLoaded(true));
  }, [org]);
  const list = useData(() => listRecords<R>('patrol_incidents', org), [org]);
  const rows = (list.data ?? []).filter((i) => i.status !== 'draft').sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  return (
    <Screen tabbar>
      <TopBar title="Incidents" large right={<SyncPill />} />
      <div class="screen-body">
        {!loaded && !rows.length ? <SkeletonList /> : rows.length ? (
          <List>
            {rows.map((i) => <Row key={i.id} icon="file" title={String(i.title || i.category_name || 'Incident')} sub={`${i.report_no ?? ''} · ${fmtDateTime(i.occurred_at as string)}`} right={<span class="pill pill-muted">{String(i.status).replace(/_/g, ' ')}</span>} />)}
          </List>
        ) : <Empty icon="file" title="No incidents" body="Submitted incident reports appear here." />}
      </div>
    </Screen>
  );
}
