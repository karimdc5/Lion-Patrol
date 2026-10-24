import { useEffect, useState } from 'preact/hooks';
import { Avatar, Button, BrandLockup } from '../../ui/kit';
import { PinPad } from '../../ui/PinPad';
import { Icon } from '../../ui/icons';
import { lockTarget, vaultEntries, unlockWithPin, phase } from '../../auth/session';
import { roleLabel } from '../../lib/format';
import { navigate } from '../../router';

export function Lock() {
  const entries = vaultEntries.value;
  const [selected, setSelected] = useState<string | null>(lockTarget.value);
  const [errorTick, setErrorTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const entry = entries.find((e) => e.userId === selected) ?? null;
  const lockedFor = entry && entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : 0;

  useEffect(() => {
    if (!lockedFor) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedFor]);

  const usePassword = () => { phase.value = 'signedOut'; navigate('/login', { replace: true }); };

  const submit = async (pin: string) => {
    if (!entry) return;
    setBusy(true); setMessage(null);
    const res = await unlockWithPin(entry.userId, pin);
    setBusy(false);
    if (res.ok) return; // stay on the screen the guard was using
    setErrorTick((x) => x + 1);
    setNow(Date.now());
    if (res.code === 'wrong_pin') setMessage(res.lockedUntil ? 'Too many attempts. Try again shortly.' : `Wrong PIN. ${res.remaining} attempts left.`);
    if (res.code === 'locked') setMessage('Too many attempts. Try again shortly.');
    if (res.code === 'wiped') { setMessage('Too many wrong PINs. Sign in with your password.'); setSelected(null); }
  };

  if (!entry) {
    return (
      <div class="screen route-enter">
        <div class="screen-body" style={{ paddingTop: 'calc(var(--safe-top) + 40px)', maxWidth: 480, margin: '0 auto', width: '100%' }}>
          <BrandLockup compact />
          <h1 class="title" style={{ textAlign: 'center', marginTop: 28 }}>Who’s on duty?</h1>
          {message && <div class="form-error" style={{ marginTop: 12 }}>{message}</div>}
          <div class="stack" style={{ marginTop: 20 }} data-testid="guard-tiles">
            {entries.map((e) => (
              <button key={e.userId} class="card card-tap row" onClick={() => { setSelected(e.userId); setMessage(null); }} data-testid={`guard-tile-${e.email}`}>
                <Avatar name={e.displayName} gold />
                <span class="grow" style={{ textAlign: 'left' }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{e.displayName}</span>
                  <span class="foot muted">{roleLabel(e.role)} · {e.orgName}</span>
                </span>
                <Icon name="chevron-right" class="chev" />
              </button>
            ))}
          </div>
          <div class="stack" style={{ marginTop: 20 }}>
            <Button variant="outline" block icon="user-plus" onClick={usePassword}>Add guard / use password</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="screen route-enter">
      <div class="screen-body" style={{ paddingTop: 'calc(var(--safe-top) + 28px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <Avatar name={entry.displayName} size="lg" gold />
        <div style={{ textAlign: 'center' }}>
          <div class="title">{entry.displayName}</div>
          <div class="muted sub">{lockedFor ? `Locked · try again in ${lockedFor}s` : 'Enter your PIN'}</div>
        </div>
        <div style={{ minHeight: 20 }} class="foot danger-text" role="alert">{message}</div>
        <PinPad onComplete={submit} disabled={busy || lockedFor > 0} error={errorTick} />
        <div class="row" style={{ gap: 20 }}>
          {entries.length > 1 && <button class="link-btn" onClick={() => { setSelected(null); lockTarget.value = null; setMessage(null); }}>Switch guard</button>}
          <button class="link-btn" onClick={usePassword}>Use password</button>
        </div>
      </div>
    </div>
  );
}
