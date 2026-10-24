import { useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, Empty } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { categoriesFor } from '../../data/repos/queries';

export function ReportStart() {
  const org = currentOrgId.value;
  const cats = useData(() => categoriesFor(org), [org]);
  const [q, setQ] = useState('');
  const list = (cats.data ?? []).filter((c) => !c.hidden && c.use_for !== 'dar' && c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen tabbar>
      <TopBar title="New report" large right={<SyncPill />} />
      <div class="screen-body stack">
        <div style={{ position: 'relative' }}>
          <input class="input" placeholder="Search categories" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ paddingLeft: 42 }} aria-label="Search categories" />
          <span style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }}><Icon name="search" size={20} /></span>
        </div>
        {list.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }} data-testid="category-grid">
            {list.map((c) => (
              <div key={c.id} class="card" style={{ padding: 14, minHeight: 96, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--hairline)' }}>
                <span class="list-icon" style={{ background: `${c.color}29`, color: c.color }}><Icon name={c.icon} /></span>
                <span style={{ fontWeight: 600, fontSize: 15, lineHeight: '19px' }}>{c.name}</span>
              </div>
            ))}
          </div>
        ) : <Empty icon="search" title="No matching categories" />}
      </div>
    </Screen>
  );
}
