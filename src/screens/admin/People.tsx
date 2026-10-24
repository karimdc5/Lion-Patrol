import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Avatar } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { membersFor } from '../../data/repos/queries';
import { roleLabel } from '../../lib/format';

export function PeopleList() {
  const org = currentOrgId.value;
  const members = useData(() => membersFor(org), [org]);
  const groups: Array<[string, string[]]> = [['Owners & admins', ['owner', 'admin']], ['Supervisors', ['supervisor']], ['Guards', ['guard']], ['Clients', ['client']]];
  return (
    <Screen tabbar>
      <TopBar title="People" large right={<SyncPill />} />
      <div class="screen-body">
        {groups.map(([label, roles]) => {
          const list = (members.data ?? []).filter((m) => roles.includes(m.role));
          if (!list.length) return null;
          return (
            <div key={label}>
              <SectionLabel>{label}</SectionLabel>
              <List>
                {list.map((m) => <Row key={m.id} title={<span class="row" style={{ gap: 10 }}><Avatar name={m.display_name} />{m.display_name}</span>} sub={`${roleLabel(m.role)}${m.status === 'disabled' ? ' · disabled' : ''}`} />)}
              </List>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
