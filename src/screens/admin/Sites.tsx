import { Screen, TopBar, SyncPill, List, Row, Empty, SkeletonList } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { sitesFor, checkpointsFor } from '../../data/repos/queries';

export function SitesList() {
  const org = currentOrgId.value;
  const sites = useData(() => sitesFor(org, null, true), [org]);
  const cps = useData(() => checkpointsFor(org), [org]);
  return (
    <Screen tabbar>
      <TopBar title="Sites" large right={<SyncPill />} />
      <div class="screen-body">
        {sites.loading ? <SkeletonList /> : sites.data?.length ? (
          <List>
            {sites.data.map((s) => (
              <Row key={s.id} icon={s.kind === 'apartment' ? 'building' : 'store'} iconBg="var(--gold-soft)" iconColor="var(--gold)" title={s.name}
                sub={`${[s.address, s.city].filter(Boolean).join(', ')} · ${(cps.data ?? []).filter((c) => c.site_id === s.id).length} checkpoints`} />
            ))}
          </List>
        ) : <Empty icon="building" title="No sites yet" body="Add your first client site to start patrols." />}
      </div>
    </Screen>
  );
}
