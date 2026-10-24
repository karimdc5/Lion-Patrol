import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons';
import { haptic } from './kit';

/** 4–6 digit PIN pad with large keys. Calls onComplete when `length` digits are entered (or on ✓ for variable length). */
export function PinPad({ length, onComplete, disabled, error, minLength = 4, maxLength = 6, testid = 'pin' }: {
  length?: number; onComplete: (pin: string) => void; disabled?: boolean; error?: number; minLength?: number; maxLength?: number; testid?: string;
}) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const target = length ?? maxLength;
  useEffect(() => {
    if (!error) return;
    setShake(true); setPin('');
    haptic('warning');
    const t = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(t);
  }, [error]);
  const press = (d: string) => {
    if (disabled || pin.length >= target) return;
    haptic();
    const next = pin + d;
    setPin(next);
    if (length && next.length === length) setTimeout(() => onComplete(next), 80);
  };
  const del = () => { if (!disabled) setPin(pin.slice(0, -1)); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') del();
      else if (e.key === 'Enter' && !length && pin.length >= minLength) onComplete(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const letters = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
  return (
    <div class="stack-lg" style={{ alignItems: 'center' }} data-testid={testid}>
      <div class={`pin-dots${shake ? ' shake' : ''}`} aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: length ?? Math.max(minLength, pin.length) }, (_, i) => <span key={i} class={`pin-dot${i < pin.length ? ' filled' : ''}`} />)}
      </div>
      <div class="pin-pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} class="pin-key" onClick={() => press(String(n))} disabled={disabled} aria-label={String(n)} data-key={n}>
            {n}<small>{letters[n - 1]}</small>
          </button>
        ))}
        {length ? <span /> : (
          <button class="pin-key ghost" onClick={() => pin.length >= minLength && onComplete(pin)} disabled={disabled || pin.length < minLength} aria-label="Done" data-key="ok">
            <Icon name="check" size={26} />
          </button>
        )}
        <button class="pin-key" onClick={() => press('0')} disabled={disabled} aria-label="0" data-key="0">0</button>
        <button class="pin-key ghost" onClick={del} disabled={disabled} aria-label="Delete" data-key="del"><Icon name="delete" size={24} /></button>
      </div>
    </div>
  );
}
