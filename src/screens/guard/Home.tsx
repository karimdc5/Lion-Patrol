import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Empty, Skeleton } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, membership, isStaff } from '../../auth/session';
import { sitesFor, shiftsFor, openTimeEntry, checkpointsFor } from '../../data/repos/queries';
import { fmtDay, fmtTime, hms } from '../../lib/format';
import { navigate } from '../../router';
import { useEffect, useState } from 'preact/hooks';

export function GuardHome() {
  const org = currentOrgId.value;
  const me = memberId.value;
  const staff = isStaff.value;
  const sites = useData(() => sitesFor(org, me, staff), [org, me, staff]);
  const shifts = useData(() => shiftsFor(org), [org]);
  const entry = useData(() => openTimeEntry(org, me), [org, me]);
  const onDuty = !!entry.data;
  const site = sites.data?.find((s) => s.id === entry.data?.site_id);
  const cps = useData(() => checkpointsFor(org, site?.id), [org, site?.id]);
  const next = (shifts.data ?? []).filter((s) => s.member_id === me && Date.parse(s.ends_at) > Date.now())[0];
  const first = membership.value?.display_name.split(' ')[0] ?? '';

  return (
    <Screen tabbar>
      <TopBar title={`Hi, ${first}`} large right={<SyncPill />} />
      <div class="screen-body stack-lg">
        <div class="hero" data-testid="duty-hero">
          <div class="row">
            <DutyRing onDuty={onDuty} since={entry.data?.clock_in_at} />
            <div class="grow">
              <div class="cap muted">{onDuty ? 'On duty' : 'Off duty'}</div>
              <div class="title tnum" style={{ marginTop: 2 }}>{onDuty ? <Elapsed since={entry.data!.clock_in_at} /> : 'Not clocked in'}</div>
              <div class="foot muted ellipsis" style={{ marginTop: 2 }}>
                {onDuty ? site?.name ?? 'Your site' : next ? `Next shift ${fmtDay(next.starts_at)}, ${fmtTime(next.starts_at)}` : 'No upcoming shifts'}
              </div>
            </div>
          </div>
          {onDuty && cps.data && (
            <div class="row" style={{ marginTop: 14, gap: 8 }}>
              <span class="pill pill-gold"><Icon name="qr" size={14} /> {cps.data.length} checkpoints</span>
            </div>
          )}
        </div>

        <div>
          <SectionLabel>{staff ? 'Sites' : 'Your sites'}</SectionLabel>
          {sites.loading ? <Skeleton h={120} r={16} /> : sites.data?.length ? (
            <List>
              {sites.data.map((s) => (
                <Row key={s.id} icon={s.kind === 'apartment' ? 'building' : 'store'} iconBg="var(--gold-soft)" iconColor="var(--gold)"
                  title={s.name} sub={[s.address, s.city].filter(Boolean).join(', ')} chevron onClick={() => navigate(`/g/post-orders/${s.id}`)} testid="site-row" />
              ))}
            </List>
          ) : (
            <Empty icon="building" title="No sites assigned yet" body="Ask your supervisor to assign you to a site." />
          )}
        </div>

        <div>
          <SectionLabel>Upcoming shifts</SectionLabel>
          {(shifts.data ?? []).filter((s) => s.member_id === me && Date.parse(s.ends_at) > Date.now()).slice(0, 5).length ? (
            <List>
              {(shifts.data ?? []).filter((s) => s.member_id === me && Date.parse(s.ends_at) > Date.now()).slice(0, 5).map((s) => (
                <Row key={s.id} icon="calendar" title={fmtDay(s.starts_at)} sub={`${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)} · ${sites.data?.find((x) => x.id === s.site_id)?.name ?? ''}`} />
              ))}
            </List>
          ) : (
            <Empty icon="calendar" title="No shifts scheduled" body="Your schedule appears here when a supervisor assigns you." />
          )}
        </div>
      </div>
    </Screen>
  );
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <>{hms(now - Date.parse(since))}</>;
}

function DutyRing({ onDuty, since }: { onDuty: boolean; since?: string }) {
  const frac = onDuty && since ? Math.min(1, (Date.now() - Date.parse(since)) / (8 * 3600e3)) : 0;
  const r = 36, c = 2 * Math.PI * r;
  return (
    <div class="ring" aria-hidden="true">
      <svg viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--raised-2)" stroke-width="7" />
        {onDuty && <circle cx="42" cy="42" r={r} fill="none" stroke="var(--success)" stroke-width="7" stroke-linecap="round" stroke-dasharray={`${c * Math.max(frac, 0.03)} ${c}`} />}
      </svg>
      <div class="ring-label" style={{ color: onDuty ? 'var(--success)' : 'var(--text-3)' }}><Icon name="shield" size={26} /></div>
    </div>
  );
}
