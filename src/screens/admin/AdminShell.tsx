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
import { isAdmin } from '../../auth/session';
import { useOpsRefresh } from './useOps';
import { PdfReadySheet } from '../../ui/PdfReady';

const TABS: TabDef[] = [
  { href: '/a', label: 'Live', icon: 'map' },
  { href: '/a/feed', label: 'Activity', icon: 'activity', match: (p) => startsWith('/a/feed', p) },
  { href: '/a/incidents', label: 'Incidents', icon: 'file', match: (p) => startsWith('/a/incidents', p) },
  { href: '/a/sites', label: 'Sites', icon: 'building', match: (p) => startsWith('/a/sites', p) },
  { href: '/a/more', label: 'More', icon: 'more', match: (p) => ['/a/more', '/a/people', '/a/schedule', '/a/settings'].some((x) => startsWith(x, p)) },
];
const SIDE = [
  ...TABS.slice(0, 4),
  { href: '/a/people', label: 'People', icon: 'users', match: (p: string) => startsWith('/a/people', p) },
  { href: '/a/schedule', label: 'Schedule', icon: 'calendar', match: (p: string) => startsWith('/a/schedule', p) },
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
  else if (p === '/a/settings') screen = <SettingsScreen />;
  else if (p === '/a/settings/categories' && isAdmin.value) screen = <CategoriesScreen />;
  else if (p === '/a/more') screen = <MoreScreen base="/a" />;
  else if (p === '/a/more/sync') screen = <SyncScreen base="/a" />;
  else screen = <Dashboard />;
  const hideTabs = /^\/a\/(incidents|sites|people)\/.+|^\/a\/settings\/categories|^\/a\/more\/sync/.test(p);
  return (
    <div class="has-sidebar" data-shell="admin">
      <aside class="shell-side" aria-label="Sections">
        <div style={{ padding: '4px 8px 18px' }}><BrandLockup compact /></div>
        {SIDE.map((t) => {
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
      <PdfReadySheet />
    </div>
  );
}
