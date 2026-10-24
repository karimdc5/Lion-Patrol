import { Screen, TopBar, List, Row, SectionLabel } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { categoriesFor, orgSettings, orgById } from '../../data/repos/queries';

export function SettingsScreen() {
  const org = currentOrgId.value;
  const o = useData(() => orgById(org), [org]);
  const s = useData(() => orgSettings(org), [org]);
  const cats = useData(() => categoriesFor(org), [org]);
  return (
    <Screen tabbar>
      <TopBar title="Settings" large />
      <div class="screen-body">
        <SectionLabel>Organization</SectionLabel>
        <List>
          <Row icon="building" title={o.data?.name ?? '—'} sub={o.data?.timezone} />
        </List>
        <SectionLabel>Notifications</SectionLabel>
        <List>
          <Row icon="bell" title="Owner emails" sub={(s.data?.notify_emails ?? []).join(', ') || 'None'} />
          <Row icon="users" title="Client notifications" sub="Not available in this version" right={<span class="pill pill-muted">Off</span>} />
        </List>
        <SectionLabel>Report categories</SectionLabel>
        <List>
          {(cats.data ?? []).map((c) => <Row key={c.id} icon={c.icon} iconBg={`${c.color}29`} iconColor={c.color} title={c.name} sub={c.hidden ? 'Hidden' : undefined} />)}
        </List>
      </div>
    </Screen>
  );
}
