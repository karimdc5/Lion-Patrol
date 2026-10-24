import { useState } from 'preact/hooks';
import { Button, Field, TopBar, Screen } from '../../ui/kit';
import { createOrg, identity, signOut } from '../../auth/session';
import { navigate } from '../../router';
import { isNetworkError } from '../../data/backend/types';

/** First-run bootstrap for owners listed in public.app_admins. */
export function Setup() {
  const [name, setName] = useState('Lion Security Services');
  const [display, setDisplay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || !display.trim()) { setError('Enter the company name and your name.'); return; }
    setBusy(true); setError(null);
    try {
      await createOrg(name.trim(), display.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(isNetworkError(err) ? 'You’re offline. Connect to create your organization.' : (err as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Screen>
      <TopBar title="Set up your company" large sub={`Signed in as ${identity.value?.email ?? ''}`} right={<button class="link-btn" onClick={() => void signOut()}>Sign out</button>} />
      <div class="screen-body">
        <form class="stack" onSubmit={submit} style={{ maxWidth: 480 }}>
          <p class="muted sub">You’re on the owners list. Create your organization to get started. We’ll add a full set of report categories you can customize later.</p>
          <Field label="Company name"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} name="org" /></Field>
          <Field label="Your name (as shown on reports)"><input class="input" value={display} onInput={(e) => setDisplay((e.target as HTMLInputElement).value)} autoComplete="name" name="display" /></Field>
          {error && <div class="form-error">{error}</div>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>Create organization</Button>
        </form>
      </div>
    </Screen>
  );
}

export function NoAccess() {
  return (
    <Screen>
      <TopBar title="Almost there" large sub={identity.value?.email} />
      <div class="screen-body stack">
        <p class="muted">Your account isn’t linked to a company yet. Ask your manager for an invite code.</p>
        <Button variant="primary" size="lg" block onClick={() => navigate('/join')}>Enter invite code</Button>
        <Button variant="outline" block onClick={() => void signOut()}>Sign out</Button>
      </div>
    </Screen>
  );
}
