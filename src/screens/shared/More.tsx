import { useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, SyncPill, Avatar, Button, Sheet, toast } from '../../ui/kit';
import { identity, membership, role, uiMode, setUiMode, backendMode, resetDemo, exitDemo, signOut, switchGuard, lockNow, isStaff } from '../../auth/session';
import { navigate } from '../../router';
import { roleLabel } from '../../lib/format';
import { isStandalone } from '../../lib/platform';
import { EnrollPinSheet } from '../public/EnrollPin';
import { useData } from '../../ui/useData';
import * as vault from '../../auth/vault';
import { queue } from '../../data/sync/status';

export function MoreScreen({ base }: { base: '/g' | '/a' | '/c' }) {
  const m = membership.value;
  const [enroll, setEnroll] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const enrolled = useData(() => vault.isEnrolled(identity.value?.userId ?? ''), [identity.value?.userId, enroll]);
  const staff = isStaff.value;
  const pending = queue.value.pending + queue.value.inflight + queue.value.dead;
  return (
    <Screen tabbar={base !== '/c'}>
      <TopBar title="More" large right={<SyncPill onClick={() => navigate(`${base}/more/sync`)} />} />
      <div class="screen-body">
        <div class="card row" style={{ marginTop: 4 }}>
          <Avatar name={m?.display_name ?? identity.value?.email ?? '?'} size="lg" gold />
          <div class="grow">
            <div class="headline">{m?.display_name ?? identity.value?.email}</div>
            <div class="foot muted">{roleLabel(role.value ?? '')} · {identity.value?.email}</div>
          </div>
        </div>

        {base === '/a' && (
          <>
            <SectionLabel>Manage</SectionLabel>
            <List>
              <Row icon="users" title="People & invites" chevron href="/a/people" testid="more-people" />
              <Row icon="calendar" title="Schedule" chevron href="/a/schedule" testid="more-schedule" />
              <Row icon="settings" title="Settings & categories" chevron href="/a/settings" testid="more-settings" />
            </List>
          </>
        )}
        {staff && (
          <>
            <SectionLabel>Mode</SectionLabel>
            <List>
              <Row icon={uiMode.value === 'admin' ? 'shield' : 'layers'} iconBg="var(--gold-soft)" iconColor="var(--gold)"
                title={uiMode.value === 'admin' ? 'Switch to Guard mode' : 'Switch to Admin mode'}
                sub={uiMode.value === 'admin' ? 'Clock in, patrol and report from your post' : 'Dashboard, sites, people and settings'}
                chevron testid="mode-switch"
                onClick={async () => { const next = uiMode.value === 'admin' ? 'guard' : 'admin'; await setUiMode(next); navigate(next === 'admin' ? '/a' : '/g', { replace: true }); }} />
            </List>
          </>
        )}

        <SectionLabel>This device</SectionLabel>
        <List>
          <Row icon="cloud-up" title="Sync" sub={pending ? `${pending} item${pending === 1 ? '' : 's'} waiting` : 'Everything is saved'} chevron href={`${base}/more/sync`} testid="row-sync" />
          <Row icon="key" title={enrolled.data ? 'Change PIN' : 'Set a PIN for quick unlock'} sub={enrolled.data ? 'Remembered on this device' : 'Unlock in seconds on a shared phone'} chevron onClick={() => setEnroll(true)} testid="row-pin" />
          {enrolled.data && <Row icon="lock" title="Lock now" chevron onClick={() => void lockNow()} testid="row-lock" />}
          <Row icon="swap" title="Switch guard" sub="Let another guard sign in on this phone" chevron onClick={() => void switchGuard()} testid="row-switch" />
          {!isStandalone() && <Row icon="smartphone" title="Install on Home Screen" chevron href="/install" />}
        </List>

        {backendMode.value === 'demo' && (
          <>
            <SectionLabel>Demo mode · sample data on this device</SectionLabel>
            <List>
              <Row icon="refresh" title="Reset demo data" chevron onClick={() => void resetDemo()} />
              <Row icon="log-out" title="Exit demo" chevron onClick={() => void exitDemo()} />
            </List>
          </>
        )}

        <SectionLabel>Account</SectionLabel>
        <List>
          <Row icon="log-out" title="Sign out" danger onClick={() => setConfirmOut(true)} testid="row-signout" />
        </List>
        <p class="foot faint" style={{ textAlign: 'center', marginTop: 24 }}>Lion Patrol · Lion Security Services<br />Build {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</p>
      </div>
      <EnrollPinSheet open={enroll} onClose={() => setEnroll(false)} />
      <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?" testid="signout-sheet"
        footer={<>
          <Button variant="danger" size="lg" block onClick={async () => { setConfirmOut(false); await signOut({ forget: true }); toast('Signed out'); navigate('/', { replace: true }); }} data-testid="signout-confirm">Sign out and forget this device</Button>
          {enrolled.data && <Button block onClick={async () => { setConfirmOut(false); await signOut(); navigate('/', { replace: true }); }}>Sign out, keep my PIN</Button>}
          <Button variant="ghost" block onClick={() => setConfirmOut(false)}>Cancel</Button>
        </>}>
        <p class="muted sub">{pending ? `You have ${pending} unsynced item${pending === 1 ? '' : 's'}. They stay on this phone and upload next time you sign in.` : 'You can sign back in any time.'}</p>
      </Sheet>
    </Screen>
  );
}
