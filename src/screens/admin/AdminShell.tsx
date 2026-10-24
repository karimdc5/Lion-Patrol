import { TabBar, type TabDef } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { path, startsWith, navigate } from '../../router';
import { MoreScreen } from '../shared/More';
import { SyncScreen } from '../shared/Sync';
import { Dashboard } from './Dashboard';
import { SitesList } from './Sites';
import { PeopleList } from './People';
import { SettingsScreen } from './Settings';
import { IncidentsList } from './Incidents';
import { isAdmin } from '../../auth/session';
import { BrandLockup } from '../../ui/kit';

const TABS: TabDef[] = [
  { href: '/a', label: 'Live', icon: 'map' },
  { href: '/a/incidents', label: 'Incidents', icon: 'file', match: (p) => startsWith('/a/incidents', p) },
  { href: '/a/sites', label: 'Sites', icon: 'building', match: (p) => startsWith('/a/sites', p) },
  { href: '/a/people', label: 'People', icon: 'users', match: (p) => startsWith('/a/people', p) },
  { href: '/a/more', label: 'More', icon: 'more', match: (p) => startsWith('/a/more', p) || startsWith('/a/settings', p) },
];
const SIDE = [
  ...TABS.slice(0, 4),
  { href: '/a/settings', label: 'Settings', icon: 'settings', match: (p: string) => startsWith('/a/settings', p) },
  { href: '/a/more', label: 'More', icon: 'more', match: (p: string) => startsWith('/a/more', p) },
];

export default function AdminShell() {
  const p = path.value;
  let screen;
  if (p === '/a/incidents') screen = <IncidentsList />;
  else if (p === '/a/sites') screen = <SitesList />;
  else if (p === '/a/people') screen = <PeopleList />;
  else if (p === '/a/settings' && isAdmin.value) screen = <SettingsScreen />;
  else if (p === '/a/more') screen = <MoreScreen base="/a" />;
  else if (p === '/a/more/sync') screen = <SyncScreen base="/a" />;
  else screen = <Dashboard />;
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
        <TabBar tabs={TABS} current={p} />
      </div>
    </div>
  );
}
