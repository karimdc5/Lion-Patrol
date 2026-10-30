import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon, type IconName } from './icons';
import { navigate, back } from '../router';
import { syncState, syncLabel } from '../data/sync/status';
import { initials } from '../lib/format';

// ---------- buttons ----------
type BtnProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'ghost' | 'outline' | 'default' | 'success';
  size?: 'lg' | 'md';
  block?: boolean;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
};
export function Button({ variant = 'default', size = 'md', block, icon, loading, children, class: cls, disabled, type = 'button', ...rest }: BtnProps) {
  const c = ['btn', variant !== 'default' && `btn-${variant}`, size === 'lg' && 'btn-lg', block && 'btn-block', cls].filter(Boolean).join(' ');
  return (
    <button type={type} class={c} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span class="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

// ---------- screen + top bar ----------
export function Screen({ children, tabbar, class: cls }: { children: ComponentChildren; tabbar?: boolean; class?: string }) {
  return <div class={['screen', 'route-enter', tabbar && 'with-tabbar', cls].filter(Boolean).join(' ')}>{children}</div>;
}

export function TopBar({ title, large, backTo, right, left, sub, action }: { title?: ComponentChildren; large?: boolean; backTo?: string | true; right?: ComponentChildren; left?: ComponentChildren; sub?: ComponentChildren; action?: ComponentChildren }) {
  // iOS pattern: an opaque compact bar stays pinned; the large title scrolls away and the
  // compact title fades in once it has scrolled under the bar.
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(!large);
  useEffect(() => {
    const on = () => { setScrolled(window.scrollY > 2); if (large) setCollapsed(window.scrollY > 44); };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [large]);
  return (
    <>
      <header class={`topbar${scrolled ? ' scrolled' : ''}`}>
        <div class="topbar-row">
          {backTo ? (
            <button class="icon-btn" aria-label="Back" onClick={() => (backTo === true ? back() : navigate(backTo))}>
              <Icon name="chevron-left" />
            </button>
          ) : left ?? <span style={{ width: 40 }} />}
          <div class={`topbar-title ellipsis${collapsed ? ' shown' : ''}`} aria-hidden={large && !collapsed ? 'true' : undefined}>{title}</div>
          <div class="row" style={{ gap: 6, minWidth: 40, justifyContent: 'flex-end' }}>{right}{(!large || collapsed) && action}</div>
        </div>
      </header>
      {large && (
        <div class="topbar-large">
          <div class="topbar-large-row"><h1 class="large-title">{title}</h1>{!collapsed && action}</div>
          {sub && <div class="muted sub" style={{ marginTop: 2 }}>{sub}</div>}
        </div>
      )}
    </>
  );
}

// ---------- tab bar ----------
export interface TabDef { href: string; label: string; icon: IconName; center?: boolean; match?: (p: string) => boolean; onLongPress?: () => void }
export function TabBar({ tabs, current }: { tabs: TabDef[]; current: string }) {
  return (
    <nav class="tabbar" aria-label="Main">
      <div class="tabbar-inner">
        {tabs.map((t) => {
          const active = t.match ? t.match(current) : current === t.href;
          if (t.center) {
            return (
              <div class="tab tab-center" key={t.href}>
                <LongPressable class="tab-fab" label={t.label} onTap={() => navigate(t.href)} onLongPress={t.onLongPress}>
                  <Icon name={t.icon} strokeWidth={2.4} />
                </LongPressable>
              </div>
            );
          }
          return (
            <a key={t.href} href={t.href} class={`tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); navigate(t.href); }}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function LongPressable({ children, onTap, onLongPress, class: cls, label }: { children: ComponentChildren; onTap: () => void; onLongPress?: () => void; class?: string; label: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = () => {
    fired.current = false;
    if (!onLongPress) return;
    timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, 2000);
  };
  const end = () => { if (timer.current) clearTimeout(timer.current); };
  return (
    <button class={cls} aria-label={label} onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()} onClick={() => { if (!fired.current) onTap(); }}>
      {children}
    </button>
  );
}

// ---------- lists ----------
export function List({ children, class: cls }: { children: ComponentChildren; class?: string }) {
  return <div class={`list ${cls ?? ''}`}>{children}</div>;
}
export function Row({ icon, iconBg, iconColor, title, sub, right, chevron, onClick, href, danger, testid, media }: {
  icon?: IconName; iconBg?: string; iconColor?: string; title: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren;
  chevron?: boolean; onClick?: () => void; href?: string; danger?: boolean; testid?: string; media?: ComponentChildren;
}) {
  const body = (
    <>
      {media}
      {!media && icon && (
        <span class="list-icon" style={{ background: iconBg ?? 'var(--raised-2)', color: iconColor ?? 'var(--text)' }}>
          <Icon name={icon} />
        </span>
      )}
      <span class="grow" style={{ minWidth: 0 }}>
        <span class={`ellipsis ${danger ? 'danger-text' : ''}`} style={{ display: 'block', fontWeight: 500 }}>{title}</span>
        {sub && <span class="foot muted" style={{ display: 'block', marginTop: 1 }}>{sub}</span>}
      </span>
      {right}
      {chevron && <Icon name="chevron-right" class="chev" />}
    </>
  );
  if (onClick || href) {
    return (
      <button class="list-row tap" data-testid={testid} onClick={() => (href ? navigate(href) : onClick?.())}>{body}</button>
    );
  }
  return <div class="list-row" data-testid={testid}>{body}</div>;
}
export function SectionLabel({ children }: { children: ComponentChildren }) {
  return <div class="section-label cap">{children}</div>;
}

// ---------- fields ----------
export function Field({ label, error, hint, children }: { label?: string; error?: string | null; hint?: ComponentChildren; children: ComponentChildren }) {
  return (
    <label class="field">
      {label && <span class="field-label">{label}</span>}
      {children}
      {error ? <span class="field-error" role="alert">{error}</span> : hint ? <span class="field-hint">{hint}</span> : null}
    </label>
  );
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span class="toggle">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span />
    </span>
  );
}

// ---------- empty / skeleton ----------
export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-icon"><Icon name={icon} /></div>
      <div class="headline">{title}</div>
      {body && <div class="muted sub" style={{ maxWidth: 300 }}>{body}</div>}
      {action}
    </div>
  );
}
export function Skeleton({ h = 18, w = '100%', r = 10, style }: { h?: number; w?: number | string; r?: number; style?: JSX.CSSProperties }) {
  return <div class="skel" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div class="list" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div class="list-row" key={i}>
          <Skeleton h={32} w={32} r={9} />
          <div class="grow stack" style={{ gap: 6 }}><Skeleton h={14} w="60%" /><Skeleton h={11} w="35%" /></div>
        </div>
      ))}
    </div>
  );
}

// ---------- avatar / brand ----------
export function Avatar({ name, size = 'md', gold }: { name: string; size?: 'md' | 'lg'; gold?: boolean }) {
  return <span class={`avatar ${size === 'lg' ? 'avatar-lg' : ''} ${gold ? 'avatar-gold' : ''}`} aria-hidden="true">{initials(name)}</span>;
}
export function BrandLockup({ compact }: { compact?: boolean }) {
  return (
    <div class="brand-lockup">
      <img class="brand-mark" src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`} alt="Lion Security Services" style={compact ? { width: 64 } : undefined} />
      <div>
        <div class="brand-name">LION SECURITY SERVICES</div>
        <div class="brand-product" style={{ marginTop: 6 }}>Lion Patrol</div>
      </div>
    </div>
  );
}

// ---------- sync pill ----------
export function SyncPill({ onClick }: { onClick?: () => void }) {
  const st = syncState.value;
  const icon: IconName = st === 'synced' ? 'cloud-check' : st === 'offline' ? 'wifi-off' : st === 'error' ? 'alert' : 'cloud-up';
  return (
    <button class={`sync-pill sync-${st}`} onClick={onClick ?? (() => navigate(location.pathname.includes('/a') ? '/a/more/sync' : '/g/more/sync'))} data-testid="sync-pill" aria-live="polite">
      <Icon name={icon} />
      <span>{syncLabel.value}</span>
    </button>
  );
}

// ---------- sheet ----------
export function Sheet({ open, onClose, title, children, footer, testid }: { open: boolean; onClose: () => void; title?: ComponentChildren; children: ComponentChildren; footer?: ComponentChildren; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const onDown = (e: PointerEvent) => { drag.current = { y: e.clientY, dy: 0 }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: PointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onUp = () => {
    if (!drag.current || !ref.current) return;
    if (drag.current.dy > 90) onClose();
    else { ref.current.style.transition = 'transform 180ms'; ref.current.style.transform = ''; setTimeout(() => ref.current && (ref.current.style.transition = ''), 200); }
    drag.current = null;
  };
  return (
    <>
      <div class="sheet-backdrop" onClick={onClose} />
      <div class="sheet" ref={ref} role="dialog" aria-modal="true" data-testid={testid}>
        <div class="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {title && (
          <div class="sheet-head">
            <div class="sheet-title">{title}</div>
            <button class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
          </div>
        )}
        <div class="sheet-body">{children}</div>
        {footer && <div class="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

// ---------- toast ----------
interface ToastMsg { id: number; text: string; kind: 'success' | 'error' | 'info' }
export const toasts = signal<ToastMsg[]>([]);
let toastId = 0;
export function toast(text: string, kind: ToastMsg['kind'] = 'success', ms = 2600) {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, ms);
}
export function Toasts() {
  return (
    <div class="toast-wrap" aria-live="polite">
      {toasts.value.slice(-2).map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`} role="status">
          <Icon name={t.kind === 'success' ? 'check-circle' : t.kind === 'error' ? 'alert' : 'info'} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- segmented ----------
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} class={v === value ? 'active' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function haptic(kind: 'tap' | 'success' | 'warning' = 'tap') {
  try { navigator.vibrate?.(kind === 'tap' ? 10 : kind === 'success' ? [12, 40, 18] : [30, 60, 30]); } catch { /* iOS: no-op */ }
}
