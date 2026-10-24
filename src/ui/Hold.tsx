import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { haptic } from './kit';

/** Press-and-hold to confirm (prevents pocket taps). Shows a filling ring. */
export function HoldButton({ ms = 2000, onConfirm, children, class: cls, label, testid, size = 132 }: {
  ms?: number; onConfirm: () => void; children: ComponentChildren; class?: string; label: string; testid?: string; size?: number;
}) {
  const [p, setP] = useState(0);
  const start = useRef(0);
  const raf = useRef(0);
  const fired = useRef(false);
  const stop = () => { cancelAnimationFrame(raf.current); start.current = 0; if (!fired.current) setP(0); };
  const tick = () => {
    if (!start.current) return;
    const v = Math.min(1, (performance.now() - start.current) / ms);
    setP(v);
    if (v >= 1) { fired.current = true; haptic('warning'); onConfirm(); return; }
    raf.current = requestAnimationFrame(tick);
  };
  const down = (e: PointerEvent) => { e.preventDefault(); fired.current = false; start.current = performance.now(); haptic(); raf.current = requestAnimationFrame(tick); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return (
    <button type="button" class={`hold ${cls ?? ''}`} aria-label={label} data-testid={testid} style={{ width: size, height: size }}
      onPointerDown={down} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !start.current) { start.current = performance.now(); fired.current = false; raf.current = requestAnimationFrame(tick); } }}
      onKeyUp={stop}>
      <svg viewBox={`0 0 ${size} ${size}`} class="hold-ring" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-dasharray={`${c * p} ${c}`} />
      </svg>
      <span class="hold-label">{children}</span>
    </button>
  );
}
