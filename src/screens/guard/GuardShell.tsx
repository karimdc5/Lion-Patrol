import { TabBar, type TabDef } from '../../ui/kit';
import { path, match, startsWith } from '../../router';
import { GuardHome } from './Home';
import { PatrolScreen } from './Patrol';
import { ReportStart } from './ReportStart';
import { ActivityScreen } from './Activity';
import { MoreScreen } from '../shared/More';
import { SyncScreen } from '../shared/Sync';
import { PostOrders } from './PostOrders';

const TABS: TabDef[] = [
  { href: '/g', label: 'Home', icon: 'home' },
  { href: '/g/patrol', label: 'Patrol', icon: 'shield', match: (p) => startsWith('/g/patrol', p) },
  { href: '/g/report', label: 'Report', icon: 'plus', center: true },
  { href: '/g/activity', label: 'Activity', icon: 'activity', match: (p) => startsWith('/g/activity', p) },
  { href: '/g/more', label: 'More', icon: 'more', match: (p) => startsWith('/g/more', p) },
];

export function GuardShell() {
  const p = path.value;
  let screen;
  let m: Record<string, string> | null;
  if (p === '/g/patrol') screen = <PatrolScreen />;
  else if (p === '/g/report') screen = <ReportStart />;
  else if (p === '/g/activity') screen = <ActivityScreen />;
  else if (p === '/g/more') screen = <MoreScreen base="/g" />;
  else if (p === '/g/more/sync') screen = <SyncScreen base="/g" />;
  else if ((m = match('/g/post-orders/:siteId', p))) screen = <PostOrders siteId={m.siteId!} />;
  else screen = <GuardHome />;
  const hideTabs = p.startsWith('/g/post-orders') || p === '/g/more/sync';
  return (
    <div data-shell="guard">
      {screen}
      {!hideTabs && <TabBar tabs={TABS} current={p} />}
    </div>
  );
}
