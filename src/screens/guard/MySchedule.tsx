import { Screen, TopBar, List, Row, Empty, Skeleton } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId } from '../../auth/session';
import { shiftsFor, siteLabels } from '../../data/repos/queries';
import { fmtDay, fmtTime } from '../../lib/format';

/** B12: guard More → Schedule. Only your own upcoming shifts (PT), never anyone else's. */
export function MySchedule() {
  const org = currentOrgId.value;
  const me = memberId.value;
  const shifts = useData(() => shiftsFor(org), [org]);
  const labels = useData(() => siteLabels(org), [org]);
  const mine = (shifts.data ?? []).filter((s) => s.member_id === me && !s.cancelled_at && Date.parse(s.ends_at) > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <Screen>
      <TopBar title="My schedule" backTo="/g/more" sub="Times are Pacific (PT)" />
      <div class="screen-body">
        {shifts.loading ? <Skeleton h={120} r={16} /> : mine.length ? (
          <List>
            {mine.map((s) => <Row key={s.id} icon="calendar" title={fmtDay(s.starts_at)} sub={`${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)} PT · ${labels.data?.label(s.site_id) ?? ''}`} testid="my-shift" />)}
          </List>
        ) : <Empty icon="calendar" title="No upcoming shifts" body="Your shifts appear here when a supervisor assigns you." />}
      </div>
    </Screen>
  );
}
