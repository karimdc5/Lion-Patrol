import { useState } from 'preact/hooks';
import { Sheet, Button, toast } from '../../ui/kit';
import { PinPad } from '../../ui/PinPad';
import { offerEnroll, enrollPin } from '../../auth/session';

/** "Remember me on this device" — set a 4–6 digit PIN for quick re-entry. */
export function EnrollPinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<'ask' | 'pin' | 'confirm'>('ask');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setStep('ask'); setFirst(''); setMsg(null); offerEnroll.value = false; onClose(); };
  return (
    <Sheet open={open} onClose={close} title={step === 'ask' ? 'Remember this device?' : step === 'pin' ? 'Choose a PIN' : 'Confirm your PIN'} testid="enroll-sheet">
      {step === 'ask' && (
        <div class="stack">
          <p class="muted sub">Set a 4–6 digit PIN to get back in quickly on this phone, even offline. Several guards can each save a PIN on a shared post phone.</p>
          <Button variant="primary" size="lg" block onClick={() => setStep('pin')} data-testid="enroll-yes">Set a PIN</Button>
          <Button variant="ghost" block onClick={close} data-testid="enroll-no">Not now</Button>
        </div>
      )}
      {step === 'pin' && (
        <div class="stack-lg" style={{ paddingBottom: 8 }}>
          <p class="muted sub" style={{ textAlign: 'center' }}>4–6 digits, then tap ✓</p>
          <PinPad onComplete={(p) => { setFirst(p); setStep('confirm'); setMsg(null); }} testid="enroll-pin" />
        </div>
      )}
      {step === 'confirm' && (
        <div class="stack-lg" style={{ paddingBottom: 8 }}>
          <p class={`sub ${msg ? 'danger-text' : 'muted'}`} style={{ textAlign: 'center' }}>{msg ?? 'Enter the same PIN again'}</p>
          <PinPad length={first.length} error={err} disabled={busy} testid="enroll-confirm" onComplete={async (p) => {
            if (p !== first) { setErr((x) => x + 1); setMsg('PINs didn’t match. Try again.'); setStep('pin'); return; }
            setBusy(true);
            try { await enrollPin(p); toast('PIN saved on this device'); close(); }
            catch (e) { setMsg((e as Error).message); }
            finally { setBusy(false); }
          }} />
        </div>
      )}
    </Sheet>
  );
}
