import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Empty, SkeletonList } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, isStaff } from '../../auth/session';
import { sitesFor, checkpointsFor } from '../../data/repos/queries';

export function PatrolScreen() {
  const org = currentOrgId.value;
  const sites = useData(() => sitesFor(org, memberId.value, isStaff.value), [org]);
  const cps = useData(() => checkpointsFor(org), [org]);
  return (
    <Screen tabbar>
      <TopBar title="Patrol" large right={<SyncPill />} sub="Checkpoints for your sites, in tour order." />
      <div class="screen-body">
        {sites.loading ? <SkeletonList /> : !sites.data?.length ? (
          <Empty icon="qr" title="No checkpoints yet" body="Once you’re assigned to a site, its checkpoints appear here." />
        ) : sites.data.map((s) => (
          <div key={s.id}>
            <SectionLabel>{s.name}</SectionLabel>
            <List>
              {(cps.data ?? []).filter((c) => c.site_id === s.id).map((c) => (
                <Row key={c.id} icon="qr" title={`${c.seq}. ${c.name}`} sub={`Code ${c.code.slice(0, 4)}-${c.code.slice(4)}`} />
              ))}
            </List>
          </div>
        ))}
      </div>
    </Screen>
  );
}
