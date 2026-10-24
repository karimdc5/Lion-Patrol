import { Screen, TopBar, SyncPill, Empty } from '../../ui/kit';

export function ActivityScreen() {
  return (
    <Screen tabbar>
      <TopBar title="Activity" large right={<SyncPill />} />
      <div class="screen-body">
        <Empty icon="activity" title="No activity yet" body="Your scans, log entries and reports for this shift appear here." />
      </div>
    </Screen>
  );
}
