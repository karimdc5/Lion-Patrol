import { useState } from 'preact/hooks';
import { Button, Field, TopBar, Screen } from '../../ui/kit';
import { signUp, signIn, redeemInvite, identity, phase } from '../../auth/session';
import { navigate, query } from '../../router';
import { isNetworkError } from '../../data/backend/types';

export function formatCode(v: string) {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^LION/, '').slice(0, 8);
  return raw.length > 4 ? `LION-${raw.slice(0, 4)}-${raw.slice(4)}` : raw.length ? `LION-${raw}` : '';
}

export function Join() {
  const signedIn = phase.value === 'ready' && !!identity.value;
  const [code, setCode] = useState(formatCode(query.value.get('code') ?? ''));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [haveAccount, setHaveAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (code.replace(/[^A-Z0-9]/g, '').length < 12) { setError('Enter the full invite code, like LION-7K4Q-9XW2.'); return; }
    if (!name.trim()) { setError('Enter your name as it should appear on reports.'); return; }
    setBusy(true);
    try {
      if (!signedIn) {
        if (haveAccount) await signIn(email, password);
        else {
          if (password.length < 8) { setError('Choose a password with at least 8 characters.'); setBusy(false); return; }
          const r = await signUp(email, password, name.trim());
          if (r === 'confirm') { setError('Check your email to confirm your account, then sign in and enter this code again.'); setBusy(false); return; }
        }
      }
      await redeemInvite(code, name.trim(), phone.trim() || undefined);
      navigate('/', { replace: true });
    } catch (err) {
      const m = (err as Error).message;
      setError(isNetworkError(err) ? 'You’re offline. Connect to the internet to join.' : /already registered|already exists/i.test(m) ? 'That email already has an account. Switch to “I already have an account”.' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar title="Join your team" large backTo={signedIn ? undefined : '/login'} sub="Enter the invite code your manager sent you." />
      <div class="screen-body">
        <form class="stack" onSubmit={submit} noValidate style={{ maxWidth: 480 }}>
          <Field label="Invite code">
            <input class="input input-code" value={code} onInput={(e) => setCode(formatCode((e.target as HTMLInputElement).value))}
              placeholder="LION-XXXX-XXXX" autoCapitalize="characters" autoComplete="one-time-code" spellcheck={false} name="code" />
          </Field>
          <Field label="Your full name">
            <input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoComplete="name" placeholder="First and last name" name="name" />
          </Field>
          <Field label="Mobile phone (optional)">
            <input class="input" type="tel" inputMode="tel" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} autoComplete="tel" placeholder="(253) 555-0100" name="phone" />
          </Field>
          {!signedIn && (
            <>
              <div class="seg" style={{ marginTop: 8 }}>
                <button type="button" class={!haveAccount ? 'active' : ''} onClick={() => setHaveAccount(false)}>New account</button>
                <button type="button" class={haveAccount ? 'active' : ''} onClick={() => setHaveAccount(true)}>I already have an account</button>
              </div>
              <Field label="Email">
                <input class="input" type="email" inputMode="email" autoComplete="username" autoCapitalize="off" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="you@email.com" name="email" />
              </Field>
              <Field label={haveAccount ? 'Password' : 'Create a password'} hint={haveAccount ? undefined : 'At least 8 characters.'}>
                <input class="input" type="password" autoComplete={haveAccount ? 'current-password' : 'new-password'} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} name="password" />
              </Field>
            </>
          )}
          {error && <div class="form-error" role="alert">{error}</div>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>Join team</Button>
        </form>
      </div>
    </Screen>
  );
}
