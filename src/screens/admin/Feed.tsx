import { useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, Empty, SkeletonList } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { loadOps, type OpsData } from './ops';
import { fmtTime, fmtDay } from '../../lib/format';
import { navigate } from '../../router';

type Kind = 'all' | 'incident' | 'log' | 'scan' | 'shift' | 'sos';
interface Item { id: string; at: string; kind: Exclude<Kind, 'all'>; title: string; sub: string; site: string; member: string; href?: string; flags?: string[] }

function items(d: OpsData): Item[] {
  const name = (id: unknown) => d.members.find((m) => m.id === id)?.display_name ?? 'Guard';
  const cp = (id: unknown) => d.checkpoints.find((c) => c.id === id)?.name ?? 'Checkpoint';
  const out: Item[] = [];
  for (const i of d.incidents) out.push({ id: i.id, at: i.occurred_at as string, kind: 'incident', title: String(i.title || i.category_name || 'Incident'), sub: `${name(i.member_id)} · ${String(i.status).replace(/_/g, ' ')}`, site: i.site_id as string, member: i.member_id as string, href: `/a/incidents/${i.id}` });
  for (const e of d.entries) out.push({ id: e.id, at: e.occurred_at as string, kind: 'log', title: String(e.body), sub: `${name(e.member_id)}${e.category_name ? ` · ${e.category_name}` : ''}`, site: e.site_id as string, member: e.member_id as string });
  for (const s of d.scans) out.push({ id: s.id, at: s.scanned_at as string, kind: 'scan', title: cp(s.checkpoint_id), sub: name(s.member_id), site: s.site_id as string, member: s.member_id as string, flags: (s.flags as string[]) ?? [] });
  for (const t of d.times) {
    out.push({ id: `${t.id}:in`, at: t.clock_in_at as string, kind: 'shift', title: 'Clocked in', sub: name(t.member_id), site: t.site_id as string, member: t.member_id as string });
    if (t.clock_out_at) out.push({ id: `${t.id}:out`, at: t.clock_out_at as string, kind: 'shift', title: 'Clocked out', sub: `${name(t.member_id)}${t.shift_note ? ` · ${t.shift_note}` : ''}`, site: t.site_id as string, member: t.member_id as string });
  }
  for (const a of d.alerts) out.push({ id: a.id, at: a.triggered_at as string, kind: 'sos', title: `SOS · ${String(a.status)}`, sub: `${a.member_name || name(a.member_id)}${a.note ? ` · ${a.note}` : ''}`, site: (a.site_id as string) ?? '', member: a.member_id as string });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const META: Record<Item['kind'], [string, string]> = {
  incident: ['alert', 'var(--danger)'], log: ['note', 'var(--gold)'], scan: ['qr', 'var(--success)'], shift: ['clock', 'var(--info)'], sos: ['bell', 'var(--danger)'],
};

export function Feed() {
  const org = currentOrgId.value;
  const d = useData(() => loadOps(org), [org]);
  const [kind, setKind] = useState<Kind>('all');
  const [site, setSite] = useState('');
  const [member, setMember] = useState('');
  const [range, setRange] = useState(1);
  const since = Date.now() - range * 864e5;
  const list = d.data ? items(d.data).filter((i) => (kind === 'all' || i.kind === kind) && (!site || i.site === site) && (!member || i.member === member) && Date.parse(i.at) >= since) : [];
  const groups: Array<[string, Item[]]> = [];
  for (const it of list.slice(0, 300)) { const day = fmtDay(it.at); const g = groups.at(-1); if (g && g[0] === day) g[1].push(it); else groups.push([day, [it]]); }
  return (
    <Screen tabbar>
      <TopBar title="Activity" large right={<SyncPill />} />
      <div class="screen-body">
        <div class="filter-row" data-testid="feed-filters">
          {(['all', 'incident', 'log', 'scan', 'shift', 'sos'] as Kind[]).map((k) => (
            <button key={k} class={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{{ all: 'All', incident: 'Incidents', log: 'Log', scan: 'Scans', shift: 'Shifts', sos: 'SOS' }[k]}</button>
          ))}
        </div>
        <div class="filter-row">
          <select class="chip" value={site} onChange={(e) => setSite((e.target as HTMLSelectElement).value)} aria-label="Site"><option value="">All sites</option>{d.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select class="chip" value={member} onChange={(e) => setMember((e.target as HTMLSelectElement).value)} aria-label="Guard"><option value="">All guards</option>{d.data?.members.filter((m) => m.role !== 'client').map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
          <select class="chip" value={String(range)} onChange={(e) => setRange(Number((e.target as HTMLSelectElement).value))} aria-label="Date range"><option value="1">Last 24 h</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
        </div>
        {d.loading ? <SkeletonList /> : !groups.length ? <Empty icon="activity" title="Nothing here" body="Try a wider date range or clear the filters." /> : groups.map(([day, its]) => (
          <div key={day}>
            <div class="tl-day cap muted">{day}</div>
            {its.map((it) => (
              <button key={it.id} class="tl-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => it.href && navigate(it.href)} data-testid="feed-item">
                <div class="tl-time">{fmtTime(it.at)}</div>
                <div class="tl-dot" style={{ background: META[it.kind][1] }} />
                <div class="tl-body">
                  <div class="tl-title"><Icon name={META[it.kind][0]} /><span class="ellipsis">{it.title}</span></div>
                  <div class="tl-sub">{d.data!.sites.find((s) => s.id === it.site)?.name ?? ''} · {it.sub}</div>
                  {it.flags && it.flags.filter((f) => f !== 'no_gps').length > 0 && <div class="row" style={{ gap: 4, marginTop: 4 }}>{it.flags.filter((f) => f !== 'no_gps').map((f) => <span key={f} class={`pill ${f === 'off_site' ? 'pill-danger' : 'pill-warning'}`}>{f.replace(/_/g, ' ')}</span>)}</div>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Screen>
  );
}
