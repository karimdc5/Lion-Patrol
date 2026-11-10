import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Sheet, Button, toast } from './kit';
import { PinPad } from './PinPad';
import { identity, uiMode, setUiMode, enrollPin } from '../auth/session';
import * as vault from '../auth/vault';
import { navigate } from '../router';
import { logAudit } from '../data/guard';

/**
 * Pass 9 A8: switching a phone from Guard mode to Owner/Admin mode needs this device's PIN.
 * No PIN yet → the owner must set one first (so a guard holding the phone can't one-tap into Admin).
 * The PIN is checked on the device by the vault (same lockout/wipe rules as the lock screen).
 */
const gate = signal<{ target: string } | null>(null);

export function requestAdmin(target = '/a') {
  if (uiMode.value === 'admin') { navigate(target); return; }
  gate.value = { target };
}

async function enter(target: string) {
  gate.value = null;
  navigate(target, { replace: true });
  await setUiMode('admin');
  void logAudit('pin_admin_switch', { detail: 'PIN verified on this device' });
}

export function AdminGateSheet() {
  const g = gate.value;
  const userId = identity.value?.userId ?? '';
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [step, setStep] = useState<'pin' | 'new' | 'confirm'>('pin');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!g || !userId) return;
    setMsg(null); setFirst('');
    void vault.isEnrolled(userId).then((e) => { setEnrolled(e); setStep(e ? 'pin' : 'new'); });
  }, [g?.target, userId]);
  const close = () => { gate.value = null; };
  const fail = (m: string) => { setErr((x) => x + 1); setMsg(m); };
  return (
    <Sheet open={!!g} onClose={close} title={step === 'pin' ? 'Enter your PIN for Admin mode' : step === 'new' ? 'Set a PIN to use Admin mode' : 'Confirm your PIN'} testid="admin-gate">
      {g && enrolled != null && (
        <div class="stack-lg" style={{ paddingBottom: 8 }}>
          <p class={`sub ${msg ? 'danger-text' : 'muted'}`} style={{ textAlign: 'center' }} data-testid="admin-gate-msg">
            {msg ?? (step === 'pin' ? 'Admin mode shows pay, codes and every site. Enter this device’s PIN.'
              : step === 'new' ? 'Owners and admins need a PIN on this device before switching from Guard mode, so a guard holding this phone can’t open Admin mode. 4–6 digits, then ✓.'
              : 'Enter the same PIN again')}
          </p>
          {step === 'pin' && <PinPad error={err} disabled={busy} testid="admin-gate-pin" onComplete={async (p) => {
            setBusy(true);
            try {
              const r = await vault.unlock(userId, p);
              if (r.ok) { await enter(g.target); return; }
              if (r.code === 'wrong_pin') fail(`Wrong PIN. ${r.remaining} tr${r.remaining === 1 ? 'y' : 'ies'} left.`);
              else if (r.code === 'locked') fail('Too many wrong PINs. Try again in a minute.');
              else if (r.code === 'wiped') { fail('Too many wrong PINs — the PIN was removed from this device. Sign out and sign in with your password.'); setEnrolled(false); }
              else { setEnrolled(false); setStep('new'); }
            } finally { setBusy(false); }
          }} />}
          {step === 'new' && <PinPad testid="admin-gate-new" onComplete={(p) => { setFirst(p); setStep('confirm'); setMsg(null); }} />}
          {step === 'confirm' && <PinPad length={first.length} error={err} disabled={busy} testid="admin-gate-confirm" onComplete={async (p) => {
            if (p !== first) { fail('PINs didn’t match. Try again.'); setStep('new'); return; }
            setBusy(true);
            try { await enrollPin(p); toast('PIN saved on this device'); await enter(g.target); }
            catch (e) { setMsg((e as Error).message); }
            finally { setBusy(false); }
          }} />}
          <Button variant="ghost" block onClick={close} data-testid="admin-gate-cancel">Stay in Guard mode</Button>
        </div>
      )}
    </Sheet>
  );
}
