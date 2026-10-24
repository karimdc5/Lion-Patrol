import { Screen, TopBar, Empty, SkeletonList } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId } from '../../auth/session';
import { listRecords } from '../../data/repos/records';
import { listDrafts } from '../../data/guard';
import { fmtTime, fmtDay } from '../../lib/format';
import { navigate } from '../../router';
import { GuardRight } from './common';
import type { Row as R } from '../../data/db';

interface Item { id: string; at: string; title: string; sub: string; color: string; icon: string; pending: boolean; href?: string }

async function loadItems(org: string | null, me: string | null): Promise<Item[]> {
  const mine = <T extends R>(rows: T[]) => rows.filter((r) => r.member_id === me);
  const [scans, entries, incidents, entriesTE, alerts, cps, drafts] = await Promise.all([
    listRecords<R>('patrol_scans', org), listRecords<R>('patrol_dar_entries', org), listRecords<R>('patrol_incidents', org),
    listRecords<R>('patrol_time_entries', org), listRecords<R>('patrol_alerts', org), listRecords<R>('patrol_checkpoints', org), listDrafts(),
  ]);
  const out: Item[] = [];
  for (const s of mine(scans)) out.push({ id: s.id, at: s.scanned_at as string, title: `Checkpoint · ${cps.find((c) => c.id === s.checkpoint_id)?.name ?? ''}`, sub: (s.flags as string[]).length ? (s.flags as string[]).join(', ').replace(/_/g, ' ') : 'On time', color: 'var(--success)', icon: 'qr', pending: !!s._pending });
  for (const e of mine(entries)) out.push({ id: e.id, at: e.occurred_at as string, title: (e.category_name as string) || 'Log entry', sub: String(e.body), color: 'var(--gold)', icon: 'note', pending: !!e._pending });
  for (const i of mine(incidents)) if (i.status !== 'draft') out.push({ id: i.id, at: i.occurred_at as string, title: `Incident · ${String(i.title || i.category_name || '')}`, sub: (i.report_no as string) ?? 'Submitted', color: 'var(--danger)', icon: 'alert', pending: !!i._pending });
  for (const d of drafts) out.push({ id: d.id, at: d.occurred_at, title: `Draft · ${d.title || 'Incident'}`, sub: 'Not submitted yet. Tap to continue', color: 'var(--warning)', icon: 'file', pending: true, href: `/g/report/${d.id}` });
  for (const t of mine(entriesTE)) {
    out.push({ id: t.id + ':in', at: t.clock_in_at as string, title: 'Clocked in', sub: '', color: 'var(--info)', icon: 'clock', pending: !!t._pending });
    if (t.clock_out_at) out.push({ id: t.id + ':out', at: t.clock_out_at as string, title: 'Clocked out', sub: String(t.shift_note ?? ''), color: 'var(--info)', icon: 'log-out', pending: !!t._pending });
  }
  for (const a of mine(alerts)) out.push({ id: a.id, at: a.triggered_at as string, title: 'SOS alert', sub: String(a.status), color: 'var(--danger)', icon: 'bell', pending: !!a._pending, href: `/g/sos?id=${a.id}` });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function ActivityScreen() {
  const org = currentOrgId.value, me = memberId.value;
  const items = useData(() => loadItems(org, me), [org, me]);
  const groups: Array<[string, Item[]]> = [];
  for (const it of items.data ?? []) {
    const day = fmtDay(it.at);
    const g = groups.at(-1);
    if (g && g[0] === day) g[1].push(it); else groups.push([day, [it]]);
  }
  return (
    <Screen tabbar>
      <TopBar title="Activity" large right={<GuardRight />} />
      <div class="screen-body" data-testid="activity">
        {items.loading ? <SkeletonList /> : !groups.length ? <Empty icon="activity" title="No activity yet" body="Your scans, log entries and reports appear here." /> : groups.map(([day, list]) => (
          <div key={day}>
            <div class="tl-day cap muted">{day}</div>
            {list.map((it) => (
              <button key={it.id} class="tl-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => it.href && navigate(it.href)} data-testid="activity-item">
                <div class="tl-time">{fmtTime(it.at)}</div>
                <div class="tl-dot" style={{ background: it.color }} />
                <div class="tl-body">
                  <div class="tl-title"><span class="ellipsis">{it.title}</span><Icon name={it.pending ? 'clock' : 'check'} /></div>
                  {it.sub && <div class="tl-sub">{it.sub}</div>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Screen>
  );
}
