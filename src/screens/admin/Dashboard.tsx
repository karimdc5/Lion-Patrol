import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Empty, Avatar } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { memberStatuses, membersFor, sitesFor, orgById } from '../../data/repos/queries';
import { relTime } from '../../lib/format';

export function Dashboard() {
  const org = currentOrgId.value;
  const statuses = useData(() => memberStatuses(org), [org]);
  const members = useData(() => membersFor(org), [org]);
  const sites = useData(() => sitesFor(org, null, true), [org]);
  const o = useData(() => orgById(org), [org]);
  const onDuty = (statuses.data ?? []).filter((s) => s.on_duty);
  return (
    <Screen tabbar>
      <TopBar title="Live" large sub={o.data?.name} right={<SyncPill />} />
      <div class="screen-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Stat label="On duty" value={onDuty.length} />
          <Stat label="Sites" value={sites.data?.length ?? 0} />
          <Stat label="Team" value={(members.data ?? []).filter((m) => m.role !== 'client').length} />
        </div>
        <SectionLabel>On shift now</SectionLabel>
        {onDuty.length ? (
          <List>
            {onDuty.map((s) => {
              const m = members.data?.find((x) => x.id === s.member_id);
              const site = sites.data?.find((x) => x.id === s.site_id);
              return <Row key={s.member_id} title={<span class="row" style={{ gap: 10 }}><Avatar name={m?.display_name ?? '?'} />{m?.display_name ?? 'Guard'}</span>} sub={`${site?.name ?? ''} · last ping ${relTime(s.last_ping_at)}`} />;
            })}
          </List>
        ) : <Empty icon="shield" title="No one is on shift" body="Guards appear here when they clock in." />}
      </div>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div class="card" style={{ padding: 14 }}>
      <div class="large-title tnum gold" style={{ fontSize: 28, lineHeight: '32px' }}>{value}</div>
      <div class="foot muted">{label}</div>
    </div>
  );
}
