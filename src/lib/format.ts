export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '')).toUpperCase();
}

export function relTime(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return 'never';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = Math.round((now - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function hms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const TZ = 'America/Los_Angeles';
export function fmtTime(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}
export function fmtDate(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }).format(new Date(iso));
}
export function fmtDay(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(new Date(iso));
}
export function fmtDateTime(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '—';
  return `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}`;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
export function siteLocalDate(iso: string, tz = TZ): string {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(new Date(iso));
  return p; // YYYY-MM-DD
}
export function roleLabel(role: string): string {
  return ({ owner: 'Owner', admin: 'Admin', supervisor: 'Supervisor', guard: 'Guard', client: 'Client' } as Record<string, string>)[role] ?? role;
}
