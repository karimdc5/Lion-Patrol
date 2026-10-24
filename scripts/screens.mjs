// Saves dark-mode iPhone 13 (WebKit) screenshots of the main screens into artifacts/screens/.
// Usage: npm run build:e2e && node scripts/screens.mjs   (starts `vite preview` itself)
import { webkit, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4174;
const BASE = `http://localhost:${PORT}/Lion-Patrol/`;
const OUT = 'artifacts/screens';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error('preview did not start'); };

let n = 0;
async function shot(page, name) {
  await page.waitForTimeout(450);
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
}

try {
  await waitUp();
  const browser = await webkit.launch();
  const ctx = async (opts = {}) => browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark', geolocation: { latitude: 47.3826, longitude: -122.2346 }, permissions: ['geolocation'], ...opts });

  // install guide (fresh iPhone Safari)
  {
    const c = await ctx(); const p = await c.newPage();
    await p.goto(BASE + '?backend=memory'); await p.getByTestId('install-guide').waitFor();
    await shot(p, 'install-guide'); await c.close();
  }
  const signIn = async (email) => {
    const c = await ctx(); const p = await c.newPage();
    await p.addInitScript(() => localStorage.setItem('lp-a2hs-dismissed', '1'));
    await p.goto(BASE + '?demo=1');
    await p.getByRole('button', { name: 'Sign in' }).waitFor();
    return { c, p, email };
  };
  // login + demo sheet
  {
    const { c, p } = await signIn();
    await shot(p, 'login');
    await p.getByTestId('try-demo').click(); await shot(p, 'login-demo-sheet');
    await p.getByTestId('demo-marcus').click(); await p.getByRole('heading', { name: 'Hi, Marcus' }).waitFor();
    await shot(p, 'guard-home');
    await p.getByRole('link', { name: 'Patrol' }).click(); await shot(p, 'guard-patrol');
    await p.getByRole('button', { name: 'Report' }).click(); await shot(p, 'guard-report-categories');
    await p.getByRole('link', { name: 'Home' }).click();
    await p.getByTestId('site-row').first().click(); await p.getByTestId('post-orders').waitFor(); await shot(p, 'guard-post-orders');
    await p.goto(BASE + 'g/more'); await p.getByRole('heading', { name: 'More' }).waitFor(); await shot(p, 'guard-more');
    await p.getByTestId('row-sync').click(); await shot(p, 'guard-sync');
    await p.goto(BASE + 'g/more'); await p.getByTestId('row-pin').click(); await p.getByTestId('enroll-sheet').waitFor(); await shot(p, 'enroll-pin-ask');
    await p.getByTestId('enroll-yes').click(); await shot(p, 'enroll-pin-pad');
    for (const d of '1234') await p.getByTestId('enroll-pin').locator(`[data-key="${d}"]`).click();
    await p.getByTestId('enroll-pin').locator('[data-key="ok"]').click();
    for (const d of '1234') await p.getByTestId('enroll-confirm').locator(`[data-key="${d}"]`).click();
    await p.getByTestId('enroll-sheet').waitFor({ state: 'detached' });
    await p.getByTestId('row-lock').click(); await p.getByText('Enter your PIN').waitFor(); await shot(p, 'lock-pin');
    await c.close();
  }
  // owner (admin)
  {
    const { c, p } = await signIn();
    await p.getByTestId('try-demo').click(); await p.getByTestId('demo-karim').click();
    await p.getByRole('heading', { name: 'Live' }).waitFor(); await shot(p, 'admin-live');
    await p.getByRole('link', { name: 'Sites' }).click(); await shot(p, 'admin-sites');
    await p.getByRole('link', { name: 'People' }).click(); await shot(p, 'admin-people');
    await p.getByRole('link', { name: 'Incidents' }).click(); await p.waitForTimeout(400); await shot(p, 'admin-incidents');
    await p.goto(BASE + 'a/settings'); await shot(p, 'admin-settings');
    await p.goto(BASE + 'a/more'); await shot(p, 'admin-more');
    await c.close();
  }
  // client
  {
    const { c, p } = await signIn();
    await p.getByTestId('try-demo').click(); await p.getByTestId('demo-manager').click();
    await p.getByText('Trespasser at loading dock').waitFor(); await shot(p, 'client-home');
    await c.close();
  }
  await browser.close();
} finally {
  server.kill();
}
