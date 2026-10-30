import { TabBar, type TabDef, BrandLockup } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { path, startsWith, navigate, match } from '../../router';
import { MoreScreen } from '../shared/More';
import { SyncScreen } from '../shared/Sync';
import { Dashboard } from './Dashboard';
import { Feed } from './Feed';
import { SitesList, SiteEditor } from './Sites';
import { PeopleList, MemberDetail } from './People';
import { SettingsScreen, CategoriesScreen } from './Settings';
import { IncidentsList, IncidentReview } from './Incidents';
import { Schedule } from './Schedule';
import { DarsList } from './Dars';
import { OwnerMap } from './Map';
import { Timesheets } from './Timesheets';
import { isAdmin } from '../../auth/session';
import { useOpsRefresh } from './useOps';

const TABS: TabDef[] = [
  { href: '/a', label: 'Live', icon: 'map' },
  { href: '/a/feed', label: 'Activity', icon: 'activity', match: (p) => startsWith('/a/feed', p) },
  { href: '/a/incidents', label: 'Incidents', icon: 'file', match: (p) => startsWith('/a/incidents', p) },
  { href: '/a/sites', label: 'Sites', icon: 'building', match: (p) => startsWith('/a/sites', p) },
  { href: '/a/more', label: 'More', icon: 'more', match: (p) => ['/a/more', '/a/people', '/a/schedule', '/a/settings', '/a/dars', '/a/map', '/a/timesheets'].some((x) => startsWith(x, p)) },
];
const SIDE = [
  ...TABS.slice(0, 4),
  { href: '/a/people', label: 'People', icon: 'users', match: (p: string) => startsWith('/a/people', p) },
  { href: '/a/schedule', label: 'Schedule', icon: 'calendar', match: (p: string) => startsWith('/a/schedule', p) },
  { href: '/a/dars', label: 'Daily reports', icon: 'note', match: (p: string) => startsWith('/a/dars', p) },
  { href: '/a/map', label: 'Map', icon: 'map', match: (p: string) => startsWith('/a/map', p), owner: true },
  { href: '/a/timesheets', label: 'Timesheets', icon: 'clock', match: (p: string) => startsWith('/a/timesheets', p), owner: true },
  { href: '/a/settings', label: 'Settings', icon: 'settings', match: (p: string) => startsWith('/a/settings', p) },
  { href: '/a/more', label: 'More', icon: 'more', match: (p: string) => startsWith('/a/more', p) },
];

export default function AdminShell() {
  useOpsRefresh();
  const p = path.value;
  let screen;
  let m: Record<string, string> | null;
  if (p === '/a/feed') screen = <Feed />;
  else if (p === '/a/incidents') screen = <IncidentsList />;
  else if ((m = match('/a/incidents/:id', p))) screen = <IncidentReview key={m.id} id={m.id!} />;
  else if (p === '/a/sites') screen = <SitesList />;
  else if ((m = match('/a/sites/:id', p))) screen = <SiteEditor key={m.id} id={m.id!} />;
  else if (p === '/a/people') screen = <PeopleList />;
  else if ((m = match('/a/people/:id', p))) screen = <MemberDetail key={m.id} id={m.id!} />;
  else if (p === '/a/schedule') screen = <Schedule />;
  else if (p === '/a/dars') screen = <DarsList />;
  else if (p === '/a/map' && isAdmin.value) screen = <OwnerMap />;
  else if (p === '/a/timesheets' && isAdmin.value) screen = <Timesheets />;
  else if (p === '/a/settings') screen = <SettingsScreen />;
  else if (p === '/a/settings/categories' && isAdmin.value) screen = <CategoriesScreen />;
  else if (p === '/a/more') screen = <MoreScreen base="/a" />;
  else if (p === '/a/more/sync') screen = <SyncScreen base="/a" />;
  else screen = <Dashboard />;
  const hideTabs = /^\/a\/(incidents|sites|people)\/.+|^\/a\/settings\/categories|^\/a\/more\/sync|^\/a\/map/.test(p);
  return (
    <div class="has-sidebar" data-shell="admin">
      <aside class="shell-side" aria-label="Sections">
        <div style={{ padding: '4px 8px 18px' }}><BrandLockup compact /></div>
        {SIDE.filter((t) => !('owner' in t && t.owner) || isAdmin.value).map((t) => {
          const active = t.match ? t.match(p) : p === t.href;
          return (
            <a key={t.href} href={t.href} class={`side-link${active ? ' active' : ''}`} onClick={(e) => { e.preventDefault(); navigate(t.href); }}>
              <Icon name={t.icon} /> {t.label}
            </a>
          );
        })}
      </aside>
      <div>
        {screen}
        {!hideTabs && <TabBar tabs={TABS} current={p} />}
      </div>
    </div>
  );
}
