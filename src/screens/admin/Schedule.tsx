import { useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, Button, Sheet, Field, Empty, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { listRecords } from '../../data/repos/records';
import { membersFor, sitesFor } from '../../data/repos/queries';
import { saveShift, cancelShift } from '../../data/admin';
import { uuidv7 } from '../../lib/uuid';
import { fmtTime } from '../../lib/format';
import type { Shift } from '../../data/types';

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function Schedule() {
  const org = currentOrgId.value;
  const shifts = useData(() => listRecords<Shift>('patrol_shifts', org), [org]);
  const members = useData(() => membersFor(org), [org]);
  const sites = useData(() => sitesFor(org, null, true), [org]);
  const [week, setWeek] = useState(0);
  const [day, setDay] = useState(ymd(new Date()));
  const [edit, setEdit] = useState<Shift | null>(null);
  const start = dayStart(new Date());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + week * 7); // Monday
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const live = (shifts.data ?? []).filter((s) => !s.cancelled_at);
  const onDay = (d: string) => live.filter((s) => ymd(new Date(s.starts_at)) === d).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const name = (id: string | null) => (id ? members.data?.find((m) => m.id === id)?.display_name ?? 'Guard' : 'Open shift');
  const siteName = (id: string) => sites.data?.find((s) => s.id === id)?.name ?? '';
  const newShift = (): Shift => {
    const d = new Date(`${day}T22:00`);
    return { id: uuidv7(), org_id: org!, site_id: sites.data?.[0]?.id ?? '', member_id: null, starts_at: d.toISOString(), ends_at: new Date(d.getTime() + 8 * 3600e3).toISOString(), notes: null, cancelled_at: null };
  };
  return (
    <Screen tabbar>
      <TopBar title="Schedule" large right={<><Button variant="primary" icon="plus" onClick={() => setEdit(newShift())} data-testid="add-shift">Shift</Button><SyncPill /></>} />
      <div class="screen-body stack">
        <div class="row-between">
          <button class="icon-btn" aria-label="Previous week" onClick={() => setWeek(week - 1)}><Icon name="chevron-left" /></button>
          <b>{days[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[6]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>
          <button class="icon-btn" aria-label="Next week" onClick={() => setWeek(week + 1)}><Icon name="chevron-right" /></button>
        </div>
        <div class="week-strip">
          {days.map((d) => {
            const k = ymd(d);
            const n = onDay(k).length;
            return (
              <button key={k} class={`week-day ${day === k ? 'on' : ''}`} onClick={() => setDay(k)}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}<b>{d.getDate()}</b>
                <span class="dots">{Array.from({ length: Math.min(n, 3) }, (_, i) => <i key={i} />)}</span>
              </button>
            );
          })}
        </div>
        {onDay(day).length ? (
          <List>
            {onDay(day).map((s) => (
              <Row key={s.id} testid="shift-row" icon="calendar" iconBg={s.member_id ? 'var(--gold-soft)' : 'var(--warning-soft)'} iconColor={s.member_id ? 'var(--gold)' : 'var(--warning)'}
                title={`${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)}`} sub={`${name(s.member_id)} · ${siteName(s.site_id)}`} chevron onClick={() => setEdit(s)} />
            ))}
          </List>
        ) : <Empty icon="calendar" title="No shifts this day" body="Tap + Shift to schedule a guard." />}
      </div>
      <ShiftSheet shift={edit} onClose={() => setEdit(null)} members={(members.data ?? []).filter((m) => m.role !== 'client' && m.status === 'active')} sites={sites.data ?? []} isNew={!!edit && !live.some((s) => s.id === edit.id)} />
    </Screen>
  );
}

function ShiftSheet({ shift, onClose, members, sites, isNew }: { shift: Shift | null; onClose: () => void; members: Array<{ id: string; display_name: string }>; sites: Array<{ id: string; name: string }>; isNew: boolean }) {
  const [s, setS] = useState<Shift | null>(null);
  const [repeat, setRepeat] = useState(0);
  const cur = s && shift && s.id === shift.id ? s : shift;
  if (!cur) return null;
  const local = (iso: string) => { const d = new Date(iso); return { date: ymd(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }; };
  const st = local(cur.starts_at), en = local(cur.ends_at);
  const setTimes = (date: string, startT: string, endT: string) => {
    const a = new Date(`${date}T${startT}`);
    let b = new Date(`${date}T${endT}`);
    if (b <= a) b = new Date(b.getTime() + 864e5); // overnight
    setS({ ...cur, starts_at: a.toISOString(), ends_at: b.toISOString() });
  };
  return (
    <Sheet open={!!shift} onClose={() => { setS(null); onClose(); }} title={isNew ? 'New shift' : 'Edit shift'} testid="shift-sheet"
      footer={<>
        <Button variant="primary" size="lg" block data-testid="shift-save" onClick={async () => { if (!cur.site_id) { toast('Pick a site', 'error'); return; } await saveShift(cur, isNew ? repeat : 0); toast(repeat && isNew ? `Saved ${repeat + 1} weekly shifts` : 'Shift saved'); setS(null); onClose(); }}>Save shift</Button>
        {!isNew && <Button variant="ghost" block onClick={async () => { await cancelShift(cur); toast('Shift cancelled'); setS(null); onClose(); }}>Cancel this shift</Button>}
      </>}>
      <div class="stack">
        <Field label="Site"><select class="input" value={cur.site_id} onChange={(e) => setS({ ...cur, site_id: (e.target as HTMLSelectElement).value })} data-testid="shift-site">{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Guard"><select class="input" value={cur.member_id ?? ''} onChange={(e) => setS({ ...cur, member_id: (e.target as HTMLSelectElement).value || null })} data-testid="shift-guard"><option value="">Open shift (unassigned)</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select></Field>
        <Field label="Date"><input class="input" type="date" value={st.date} onInput={(e) => setTimes((e.target as HTMLInputElement).value, st.time, en.time)} /></Field>
        <div class="grid-2">
          <Field label="Start"><input class="input" type="time" value={st.time} onInput={(e) => setTimes(st.date, (e.target as HTMLInputElement).value, en.time)} data-testid="shift-start" /></Field>
          <Field label="End" hint={new Date(cur.ends_at).getDate() !== new Date(cur.starts_at).getDate() ? 'Ends next day' : undefined}><input class="input" type="time" value={en.time} onInput={(e) => setTimes(st.date, st.time, (e.target as HTMLInputElement).value)} /></Field>
        </div>
        {isNew && <Field label="Repeat weekly"><select class="input" value={String(repeat)} onChange={(e) => setRepeat(Number((e.target as HTMLSelectElement).value))} data-testid="shift-repeat"><option value="0">Don’t repeat</option><option value="1">+1 week</option><option value="3">+3 weeks</option><option value="7">+7 weeks</option></select></Field>}
        <Field label="Notes"><input class="input" value={cur.notes ?? ''} onInput={(e) => setS({ ...cur, notes: (e.target as HTMLInputElement).value })} placeholder="Relieve Tasha at the main gate" /></Field>
      </div>
    </Sheet>
  );
}
