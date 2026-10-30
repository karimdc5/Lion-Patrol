import { Button, Screen, TopBar } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { navigate } from '../../router';
import { isIOS } from '../../lib/platform';

export function Install({ onContinue }: { onContinue?: () => void }) {
  const done = () => { localStorage.setItem('lp-a2hs-dismissed', '1'); onContinue ? onContinue() : navigate('/', { replace: true }); };
  const ios = isIOS();
  return (
    <Screen>
      <TopBar title="Install Lion Patrol" large sub="Add it to your Home Screen for the full app." />
      <div class="screen-body stack-lg" style={{ maxWidth: 520 }} data-testid="install-guide">
        <div class="card stack">
          <Step n={1} title={<>Tap the <b>Share</b> button</>} body="At the bottom of Safari (top on iPad).">
            <span class="list-icon" style={{ background: 'var(--info-soft)', color: '#93C5FD' }}><Icon name="share" /></span>
          </Step>
          <div class="divider" />
          <Step n={2} title={<>Choose <b>Add to Home Screen</b></>} body="Scroll down the share sheet if you don’t see it.">
            <span class="list-icon" style={{ background: 'var(--raised-2)' }}><Icon name="plus-square" /></span>
          </Step>
          <div class="divider" />
          <Step n={3} title={<>Open <b>Lion Patrol</b> from your Home Screen</>} body="It opens full screen, works offline, and keeps you signed in.">
            <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width={32} height={32} style={{ borderRadius: 8 }} alt="" />
          </Step>
        </div>
        <div class="banner banner-warning" role="note">
          <Icon name="info" />
          <div>
            <b>The Home Screen app has its own storage.</b> It doesn’t share your login or saved work with Safari, so you’ll sign in once more there. Anything saved in Safari stays in Safari. After installing, use the app from the Home Screen only.
          </div>
        </div>
        {!ios && <p class="muted sub">On Android or desktop Chrome, use the browser menu → <b>Install app</b>.</p>}
        <Button variant="outline" block onClick={done} data-testid="install-continue">Continue in browser</Button>
      </div>
    </Screen>
  );
}

function Step({ n, title, body, children }: { n: number; title: preact.ComponentChildren; body: string; children: preact.ComponentChildren }) {
  return (
    <div class="row" style={{ alignItems: 'flex-start' }}>
      <span class="step-num">{n}</span>
      <div class="grow">
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div class="foot muted" style={{ marginTop: 2 }}>{body}</div>
      </div>
      {children}
    </div>
  );
}
