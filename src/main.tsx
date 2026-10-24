import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import { App, updateReady } from './app';
import { boot, phase, backendMode, startDemo } from './auth/session';

render(<App />, document.getElementById('app')!);

void (async () => {
  await boot();
  const auto = sessionStorage.getItem('lp-demo-autologin');
  if (auto && backendMode.value === 'demo' && phase.value !== 'ready') {
    sessionStorage.removeItem('lp-demo-autologin');
    await startDemo(auto);
  }
})();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() { updateReady.value = () => void update(true); },
    });
  });
}
