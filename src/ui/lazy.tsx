import type { ComponentType } from 'preact';
import { signal } from '@preact/signals';

/**
 * Route-level code splitting without preact/compat Suspense. A signal drives re-render, so every
 * mounted instance updates when the chunk arrives (even if it mounted mid-load), and a failed
 * chunk fetch (flaky network, SW mid-install) is retried with backoff.
 */
export function lazyScreen<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>, Fallback: ComponentType = Blank) {
  const comp = signal<ComponentType<P> | null>(null);
  let promise: Promise<void> | null = null;
  let tries = 0;
  const load = (): Promise<void> => {
    if (comp.peek()) return Promise.resolve();
    promise ??= loader().then(
      (m) => { comp.value = m.default; },
      (err) => {
        promise = null;
        if (++tries <= 5) return new Promise<void>((r) => setTimeout(r, 300 * tries)).then(load);
        throw err;
      },
    );
    return promise;
  };
  function Lazy(props: P) {
    const C = comp.value;
    if (!C) { void load(); return <Fallback />; }
    return <C {...props} />;
  }
  (Lazy as unknown as { preload: () => Promise<void> }).preload = load;
  return Lazy as ComponentType<P> & { preload: () => Promise<void> };
}

function Blank() {
  return <div class="screen" aria-busy="true" />;
}
