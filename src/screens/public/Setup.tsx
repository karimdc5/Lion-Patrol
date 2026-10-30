import { useState } from 'preact/hooks';
import { Button, Field, TopBar, Screen } from '../../ui/kit';
import { createOrg, identity, signOut } from '../../auth/session';
import { navigate } from '../../router';
import { isNetworkError } from '../../data/backend/types';
import { Icon } from '../../ui/icons';

/**
 * First run for an account with no company yet (owners listed in public.app_admins). Never creates
 * a company silently: the person chooses "Join with invite code" (the normal path for anyone
 * joining an existing company) or "Create company".
 */
export function Setup() {
  const [choice, setChoice] = useState<null | 'create'>(null);
  if (!choice) return <SetupChoice onCreate={() => setChoice('create')} />;
  return <CreateCompany onBack={() => setChoice(null)} />;
}

function SetupChoice({ onCreate }: { onCreate: () => void }) {
  return (
    <Screen>
      <TopBar title="Welcome to Lion Patrol" large sub={`Signed in as ${identity.value?.email ?? ''}`} right={<button class="link-btn" onClick={() => void signOut()}>Sign out</button>} />
      <div class="screen-body stack" style={{ maxWidth: 480 }} data-testid="setup-choice">
        <p class="muted sub">Your account isn’t part of a company yet. How do you want to start?</p>
        <button class="site-card" onClick={() => navigate('/join')} data-testid="choice-join">
          <span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)', width: 44, height: 44, borderRadius: 12 }}><Icon name="key" /></span>
          <span class="grow"><span style={{ display: 'block', fontWeight: 600 }}>Join with invite code</span>
            <span class="foot muted">Your company already uses Lion Patrol. Enter the code the owner sent you.</span></span>
          <Icon name="chevron-right" class="chev" />
        </button>
        <button class="site-card" onClick={onCreate} data-testid="choice-create">
          <span class="list-icon" style={{ background: 'var(--raised-2)', width: 44, height: 44, borderRadius: 12 }}><Icon name="building" /></span>
          <span class="grow"><span style={{ display: 'block', fontWeight: 600 }}>Create company</span>
            <span class="foot muted">Start a new, separate company. Only for owners setting up Lion Patrol for the first time.</span></span>
          <Icon name="chevron-right" class="chev" />
        </button>
        <p class="foot faint">Working for a company that’s already set up? Don’t create a second one — ask the owner for an invite code (More → People → Invite).</p>
      </div>
    </Screen>
  );
}

function CreateCompany({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
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
      <TopBar title="Create company" large sub={`Signed in as ${identity.value?.email ?? ''}`} right={<button class="link-btn" onClick={onBack} data-testid="setup-back">Back</button>} />
      <div class="screen-body">
        <form class="stack" onSubmit={submit} style={{ maxWidth: 480 }}>
          <p class="muted sub">This creates a new, separate company with you as the owner. We’ll add a full set of report categories you can customize later.</p>
          <Field label="Company name"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} name="org" placeholder="Lion Security Services" /></Field>
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
