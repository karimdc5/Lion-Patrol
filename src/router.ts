import { signal } from '@preact/signals';

/** Tiny history router aware of the deploy base path (/Lion-Patrol/). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const strip = (p: string) => (p.startsWith(BASE) ? p.slice(BASE.length) : p) || '/';

export const path = signal(strip(location.pathname));
export const query = signal(new URLSearchParams(location.search));

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = new URL(to, location.origin + BASE + '/');
  const full = BASE + url.pathname + url.search;
  if (opts.replace) history.replaceState(null, '', full);
  else history.pushState(null, '', full);
  path.value = url.pathname || '/';
  query.value = url.searchParams;
  window.scrollTo(0, 0);
}

export function back(fallback = '/') {
  if (history.length > 1 && (history.state as { lp?: boolean } | null) !== null) history.back();
  else navigate(fallback, { replace: true });
}

window.addEventListener('popstate', () => {
  path.value = strip(location.pathname);
  query.value = new URLSearchParams(location.search);
});

/** Match '/a/sites/:id' against a path; returns params or null. */
export function match(pattern: string, p: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = p.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function startsWith(prefix: string, p = path.value) {
  return p === prefix || p.startsWith(prefix + '/');
}
