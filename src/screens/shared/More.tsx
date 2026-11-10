import { useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, SyncPill, Avatar, Button, Sheet, Field, toast } from '../../ui/kit';
import { identity, membership, role, uiMode, setUiMode, backendMode, resetDemo, exitDemo, signOut, switchGuard, lockNow, isStaff, isAdmin, updateMyName } from '../../auth/session';
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
  const [nameOpen, setNameOpen] = useState(false);
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
            <div class="headline" data-testid="my-name">{m?.display_name ?? identity.value?.email}</div>
            <div class="foot muted">{roleLabel(role.value ?? '')} · {identity.value?.email}</div>
          </div>
          {m && <Button variant="ghost" onClick={() => setNameOpen(true)} data-testid="edit-name">Edit</Button>}
        </div>

        {base === '/a' && (
          <>
            <SectionLabel>Manage</SectionLabel>
            <List>
              <Row icon="users" title="People & invites" chevron href="/a/people" testid="more-people" />
              <Row icon="calendar" title="Schedule" chevron href="/a/schedule" testid="more-schedule" />
              <Row icon="note" title="Daily activity reports" chevron href="/a/dars" testid="more-dars" />
              {isAdmin.value && <Row icon="map" title="Map" sub="Sites and on-duty guards (owners only)" chevron href="/a/map" testid="more-map" />}
              {isAdmin.value && <Row icon="clock" title="Timesheets" sub="Weekly hours, overtime, Gusto export" chevron href="/a/timesheets" testid="more-timesheets" />}
              {isAdmin.value && <Row icon="key" title="Guard cards" sub="WA licenses, expiry reminders, onboarding import" chevron href="/a/guard-cards" testid="more-guard-cards" />}
              {isAdmin.value && <Row icon="file" title="Invoices" sub="Monthly client invoices from clocked hours" chevron href="/a/invoices" testid="more-invoices" />}
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
                onClick={async () => { const next = uiMode.value === 'admin' ? 'guard' : 'admin'; navigate(next === 'admin' ? '/a' : '/g', { replace: true }); await setUiMode(next); }} />
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
      {nameOpen && <NameSheet open onClose={() => setNameOpen(false)} />}
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

/** Item 14: everyone can change their own display name (shown on reports and to the team). */
function NameSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = membership.value;
  const [name, setName] = useState(m?.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Your name" testid="name-sheet"
      footer={<Button variant="primary" size="lg" block loading={busy} data-testid="name-save" onClick={async () => {
        const v = name.trim().replace(/\s+/g, ' ');
        if (v.length < 2 || v.length > 60) { setErr('Use 2–60 characters.'); return; }
        setBusy(true);
        try { await updateMyName(v); toast('Name updated'); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>Save</Button>}>
      <Field label="Display name" hint="Shown on your reports and to your team." error={err}>
        <input class="input" value={name} maxLength={60} autoComplete="name" onInput={(e) => { setName((e.target as HTMLInputElement).value); setErr(null); }} data-testid="name-input" />
      </Field>
    </Sheet>
  );
}
