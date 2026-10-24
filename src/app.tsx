import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { phase, identity, uiMode, offerEnroll, backendMode, setUiMode } from './auth/session';
import { path, navigate } from './router';
import { Login } from './screens/public/Login';
import { Join, Signup } from './screens/public/Join';
import { Setup, NoAccess } from './screens/public/Setup';
import { Install } from './screens/public/Install';
import { Lock } from './screens/public/Lock';
import { EnrollPinSheet } from './screens/public/EnrollPin';
import { GuardShell } from './screens/guard/GuardShell';
import { Toasts, Button } from './ui/kit';
import { PdfReadySheet } from './ui/PdfReady';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { lazyScreen } from './ui/lazy';
import { shouldShowInstallGuide } from './lib/platform';

const AdminShell = lazyScreen(() => import('./screens/admin/AdminShell'));
const ClientShell = lazyScreen(() => import('./screens/client/ClientShell'));
const PortalPage = lazyScreen<{ token: string }>(() => import('./screens/public/Portal'));

export const updateReady = signal<null | (() => void)>(null);
const installGate = signal(shouldShowInstallGuide());

export function App() {
  return (
    <>
      <ErrorBoundary><Routes /></ErrorBoundary>
      <Toasts />
      <PdfReadySheet />
      {backendMode.value === 'demo' && <div class="demo-ribbon" aria-label="Demo mode" role="note">Demo mode</div>}
      {updateReady.value && (
        <div class="toast-wrap" style={{ top: 'auto', bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 16px)' }}>
          <div class="toast" role="status">
            <span class="grow">A new version is ready.</span>
            <Button variant="primary" onClick={() => updateReady.value?.()}>Update</Button>
          </div>
        </div>
      )}
    </>
  );
}

function Routes() {
  const ph = phase.value;
  const p = path.value;
  document.documentElement.dataset.lp = `${ph}|${p}|${uiMode.value}|${identity.value?.memberships.length ?? '-'}`;
  if (p === '/install') return <Install />;
  const portal = p.match(/^\/p\/([A-Za-z0-9_-]+)/);
  if (portal) return <PortalPage token={portal[1]!} />;
  if (ph === 'booting') return <div class="screen" aria-busy="true" />;
  if (ph === 'signedOut') {
    if (installGate.value) return <Install onContinue={() => { installGate.value = false; }} />;
    if (p.startsWith('/join')) return <Join />;
    if (p === '/signup') return <Signup />;
    return <Login />;
  }
  if (ph === 'locked') return <Lock />;

  const id = identity.value;
  if (!id) return <Login />;
  if (p.startsWith('/join')) return <Join />;
  if (!id.memberships.length) return id.isAppAdmin ? <Setup /> : <NoAccess />;
  return <RoleShell />;
}

function RoleShell() {
  const mode = uiMode.value;
  const p = path.value;
  // QR deep link (iOS Camera → /q/CODE): log it as a scan in Guard mode.
  useEffect(() => {
    const m = p.match(/^\/q\/([A-Za-z0-9-]+)/);
    if (m && mode !== 'client') { if (mode === 'admin') void setUiMode('guard'); navigate(`/g/scan?code=${m[1]}`, { replace: true }); }
  }, [p]);
  const prefix = mode === 'admin' ? '/a' : mode === 'client' ? '/c' : '/g';
  const inShell = p === prefix || p.startsWith(prefix + '/');
  // No deps on purpose: a screen may navigate('/') in the same tick as this redirect.
  useEffect(() => { if (!inShell) navigate(prefix, { replace: true }); });
  useEffect(() => {
    // Warm the other chunks after first paint so screen changes are instant.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1200));
    idle(() => { if (mode === 'admin') void AdminShell.preload(); });
  }, [mode]);
  if (!inShell) return <div class="screen" />;
  return (
    <>
      {mode === 'admin' ? <AdminShell /> : mode === 'client' ? <ClientShell /> : <GuardShell />}
      <EnrollPinSheet open={offerEnroll.value} onClose={() => { offerEnroll.value = false; }} />
    </>
  );
}
