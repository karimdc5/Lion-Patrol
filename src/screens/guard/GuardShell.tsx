import { useEffect } from 'preact/hooks';
import { TabBar, type TabDef } from '../../ui/kit';
import { path, match, startsWith } from '../../router';
import { GuardHome } from './Home';
import { PatrolScreen } from './Patrol';
import { ReportStart, IncidentEditor } from './Incident';
import { ActivityScreen } from './Activity';
import { MoreScreen } from '../shared/More';
import { SyncScreen } from '../shared/Sync';
import { PostOrders } from './PostOrders';
import { ClockScreen } from './Clock';
import { ScanScreen } from './Scan';
import { DarScreen } from './Dar';
import { GuardIncidentView, GuardDarView } from './Reports';
import { SosScreen, SosSheet, sosSheetOpen } from './Sos';
import { loadOpenEntry, refreshGuardHistory } from '../../data/guard';
import { dataVersion } from '../../data/repos/records';
import { currentOrgId, memberId } from '../../auth/session';

const TABS: TabDef[] = [
  { href: '/g', label: 'Home', icon: 'home' },
  { href: '/g/patrol', label: 'Patrol', icon: 'shield', match: (p) => startsWith('/g/patrol', p) },
  { href: '/g/report', label: 'Report', icon: 'plus', center: true, onLongPress: () => { sosSheetOpen.value = true; } },
  { href: '/g/activity', label: 'Activity', icon: 'activity', match: (p) => startsWith('/g/activity', p) || startsWith('/g/dar', p) },
  { href: '/g/more', label: 'More', icon: 'more', match: (p) => startsWith('/g/more', p) },
];

export function GuardShell() {
  const p = path.value;
  const v = dataVersion.value;
  useEffect(() => { void loadOpenEntry(); }, [v, currentOrgId.value, memberId.value]);
  useEffect(() => { void refreshGuardHistory(true); }, [currentOrgId.value, memberId.value]);
  let screen;
  let m: Record<string, string> | null;
  if (p === '/g/patrol') screen = <PatrolScreen />;
  else if (p === '/g/report') screen = <ReportStart />;
  else if ((m = match('/g/report/:id', p))) screen = <IncidentEditor key={m.id} id={m.id!} />;
  else if (p === '/g/activity') screen = <ActivityScreen />;
  else if ((m = match('/g/incidents/:id', p))) screen = <GuardIncidentView id={m.id!} />;
  else if ((m = match('/g/dars/:te', p))) screen = <GuardDarView timeEntryId={m.te!} />;
  else if (p === '/g/dar') screen = <DarScreen />;
  else if (p === '/g/clock') screen = <ClockScreen />;
  else if (p === '/g/scan') screen = <ScanScreen />;
  else if (p === '/g/sos') screen = <SosScreen />;
  else if (p === '/g/more') screen = <MoreScreen base="/g" />;
  else if (p === '/g/more/sync') screen = <SyncScreen base="/g" />;
  else if ((m = match('/g/post-orders/:siteId', p))) screen = <PostOrders siteId={m.siteId!} />;
  else screen = <GuardHome />;
  const hideTabs = /^\/g\/(post-orders|report\/|clock|scan|sos|more\/sync|incidents\/|dars\/)/.test(p);
  return (
    <div data-shell="guard">
      {screen}
      {!hideTabs && <TabBar tabs={TABS} current={p} />}
      <SosSheet />
    </div>
  );
}
