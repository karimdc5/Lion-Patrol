import { useState } from 'preact/hooks';
import { Button, Field, BrandLockup, Sheet, Row, List } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { signIn, startDemo, backendMode, exitDemo, vaultEntries, phase } from '../../auth/session';
import { navigate } from '../../router';
import { isNetworkError } from '../../data/backend/types';

const DEMO_ROLES = [
  { email: 'karim@lionsecurity.demo', name: 'Karim Daher', role: 'Owner · admin + guard mode', icon: 'shield-check' },
  { email: 'marcus@lionsecurity.demo', name: 'Marcus Reed', role: 'Guard · Kent Station Market', icon: 'user' },
  { email: 'dana@lionsecurity.demo', name: 'Dana Whitfield', role: 'Supervisor', icon: 'users' },
  { email: 'manager@kentstationmarket.demo', name: 'Priya Natarajan', role: 'Client · store manager', icon: 'store' },
] as const;

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const isDemo = backendMode.value === 'demo';

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(isNetworkError(err) ? 'Can’t reach the server. Check your connection and try again.' : /invalid/i.test((err as Error).message) ? 'Email or password is incorrect.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="screen route-enter" style={{ justifyContent: 'center' }}>
      <div class="screen-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 'calc(var(--safe-top) + 32px)', maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <BrandLockup />
        <form class="stack" style={{ marginTop: 36 }} onSubmit={submit} noValidate>
          {isDemo && <div class="form-info">Demo mode. Tap <b>Try demo</b> to pick a role. Nothing here touches real data.</div>}
          <Field label="Email">
            <input class="input" type="email" inputMode="email" autoComplete="username" autoCapitalize="off" spellcheck={false}
              value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="you@company.com" name="email" />
          </Field>
          <Field label="Password">
            <input class="input" type="password" autoComplete="current-password" value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)} placeholder="Password" name="password" />
          </Field>
          {error && <div class="form-error" role="alert">{error}</div>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>Sign in</Button>
          <div class="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <button type="button" class="link-btn" onClick={() => navigate('/join')}>Have an invite code?</button>
            <button type="button" class="link-btn" onClick={() => setDemoOpen(true)} data-testid="try-demo">Try demo</button>
          </div>
          <button type="button" class="link-btn" style={{ alignSelf: 'center' }} onClick={() => navigate('/signup')} data-testid="owner-signup">New owner? Create an account</button>
          {vaultEntries.value.length > 0 && (
            <Button variant="outline" block icon="lock" onClick={() => { phase.value = 'locked'; }}>Use a saved PIN</Button>
          )}
          {isDemo && <button type="button" class="link-btn" style={{ alignSelf: 'center' }} onClick={() => void exitDemo()}>Exit demo</button>}
        </form>
        <p class="foot faint" style={{ textAlign: 'center', marginTop: 28 }}>Authorized personnel only. Activity is logged.</p>
      </div>

      <Sheet open={demoOpen} onClose={() => setDemoOpen(false)} title="Try the demo" testid="demo-sheet">
        <p class="muted sub" style={{ marginBottom: 14 }}>Explore Lion Patrol with sample data for a retail store in Kent and an apartment complex in Federal Way.</p>
        <List>
          {DEMO_ROLES.map((r) => (
            <Row key={r.email} icon={r.icon} iconBg="var(--gold-soft)" iconColor="var(--gold)" title={r.name} sub={r.role} chevron
              testid={`demo-${r.email.split('@')[0]}`}
              onClick={async () => { setDemoOpen(false); setBusy(true); try { await startDemo(r.email); navigate('/', { replace: true }); } finally { setBusy(false); } }} />
          ))}
        </List>
        <p class="foot faint" style={{ marginTop: 12, display: 'flex', gap: 6 }}><Icon name="info" size={16} /> Demo data stays on this device.</p>
      </Sheet>
    </div>
  );
}
