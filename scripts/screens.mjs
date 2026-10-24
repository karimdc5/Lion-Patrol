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
  const ctx = async (opts = {}) => { const c = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark', geolocation: { latitude: 47.3826, longitude: -122.2346 }, permissions: ['geolocation'], ...opts }); await c.route('https://api.emailjs.com/**', (r) => r.fulfill({ status: 200, body: 'OK' })); return c; };

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
    await p.getByTestId('home-clock-in').click(); await p.getByTestId('site-option').first().click(); await shot(p, 'guard-clock-in');
    await p.getByTestId('clock-in-btn').click(); await p.getByTestId('gps-notice').waitFor(); await shot(p, 'guard-gps-notice');
    await p.getByTestId('gps-accept').click(); await p.getByTestId('duty-status').waitFor(); await p.waitForTimeout(800); await shot(p, 'guard-home-on-duty');
    await p.getByTestId('home-scan').click(); await shot(p, 'guard-scanner');
    await p.getByTestId('manual-entry').click(); await p.getByTestId('manual-code').fill('KSM1FRNT'); await shot(p, 'guard-scan-manual');
    await p.getByTestId('manual-submit').click(); await p.getByTestId('scan-result-name').waitFor(); await shot(p, 'guard-scan-result');
    await p.getByTestId('scan-done').click(); await p.getByTestId('tour-progress').waitFor(); await shot(p, 'guard-patrol');
    await p.goto(BASE + 'g/dar'); await p.getByTestId('dar-text').fill('East fire exit checked and secured.'); await p.getByTestId('dar-add').click(); await p.getByTestId('dar-entry').waitFor(); await shot(p, 'guard-dar');
    await p.getByRole('button', { name: 'Report', exact: true }).click(); await shot(p, 'guard-report-categories');
    await p.getByTestId('cat-search').fill('trespass'); await p.getByTestId('category-tile').first().click(); await p.getByTestId('incident-form').waitFor();
    await p.getByTestId('subtype-chip').first().click(); await p.getByTestId('inc-description').fill('Adult male sleeping at the loading dock. Gave a verbal warning; he left north on Ramsay Way.');
    await shot(p, 'guard-incident-top');
    await p.getByTestId('add-person').click(); await p.getByTestId('person-name').fill('Unknown male, ~40, grey hoodie');
    await p.getByTestId('police-no').scrollIntoViewIfNeeded(); await shot(p, 'guard-incident-people');
    await p.getByText('Photos, video & files').scrollIntoViewIfNeeded(); await shot(p, 'guard-incident-attachments');
    await p.goto(BASE + 'g/activity'); await p.getByTestId('activity').waitFor(); await shot(p, 'guard-activity');
    await p.getByTestId('sos-chip').click(); await p.getByTestId('sos-sheet').waitFor(); await shot(p, 'guard-sos-sheet');
    await p.goto(BASE + 'g'); await p.getByRole('heading', { name: 'Hi, Marcus' }).waitFor();
    { await p.getByTestId('home-sos').evaluate((el) => el.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); const b = await p.getByTestId('home-sos').boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(2300); await p.mouse.up(); }
    await p.getByTestId('sos-screen').waitFor(); await p.waitForTimeout(1200); await shot(p, 'guard-sos-sent');
    await p.getByTestId('sos-safe').click(); await p.goto(BASE + 'g');
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
  // owner (admin) — inject an open SOS so the Live banner is shown
  {
    const { c, p } = await signIn();
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('lp-demo-server'));
      s.tables.patrol_alerts.push({ id: 'sos-shot', org_id: '0b5e0000-0000-7000-8000-000000000001', site_id: '0b5e0000-0000-7000-8000-00000000c002', member_id: '0b5e0000-0000-7000-8000-0000000000b6', member_name: 'Tasha Greene', triggered_at: new Date(Date.now() - 60000).toISOString(), lat: 47.3221, lng: -122.3127, status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      localStorage.setItem('lp-demo-server', JSON.stringify(s));
    });
    await p.getByTestId('try-demo').click(); await p.getByTestId('demo-karim').click();
    await p.getByRole('heading', { name: 'Live' }).waitFor(); await p.getByTestId('sos-banner').waitFor(); await shot(p, 'admin-live-sos');
    await p.getByTestId('sos-ack').click(); await p.getByTestId('sos-resolve').click(); await p.waitForTimeout(300);
    await p.evaluate(() => window.scrollTo(0, 0)); await shot(p, 'admin-live');
    await p.evaluate(() => window.scrollTo(0, 900)); await shot(p, 'admin-live-completion');
    await p.getByRole('link', { name: 'Activity' }).click(); await p.getByTestId('feed-item').first().waitFor(); await shot(p, 'admin-feed');
    await p.getByRole('link', { name: 'Incidents' }).click(); await p.getByTestId('incident-row').first().waitFor(); await shot(p, 'admin-incidents');
    await p.getByTestId('incident-row').filter({ hasText: 'Vehicle idling' }).click(); await p.getByTestId('incident-review').waitFor(); await shot(p, 'admin-incident-review');
    await p.evaluate(() => window.scrollTo(0, 2000)); await shot(p, 'admin-incident-review-actions');
    await p.getByTestId('incident-pdf').click(); await p.getByTestId('pdf-ready').waitFor(); await shot(p, 'admin-incident-pdf-ready'); await p.keyboard.press('Escape');
    await p.goto(BASE + 'a/dars'); await p.getByTestId('dar-row').first().waitFor(); await shot(p, 'admin-daily-reports');
    await p.goto(BASE + 'a/sites'); await p.getByTestId('site-admin-row').first().waitFor(); await shot(p, 'admin-sites');
    await p.getByTestId('site-admin-row').first().click(); await p.getByTestId('site-name').waitFor(); await shot(p, 'admin-site-details');
    await p.getByTestId('site-tab-orders').click(); await shot(p, 'admin-site-post-orders');
    await p.getByTestId('site-tab-checkpoints').click(); await p.getByTestId('cp-admin-row').first().waitFor(); await shot(p, 'admin-site-checkpoints');
    await p.getByTestId('qr-sheet').click(); await p.getByTestId('pdf-ready').waitFor(); await shot(p, 'admin-qr-pdf-ready');
    await p.keyboard.press('Escape');
    await p.getByTestId('site-tab-access').click(); await shot(p, 'admin-site-access');
    await p.getByTestId('site-tab-portal').click(); await p.getByTestId('portal-create').click(); await p.getByTestId('portal-url').waitFor(); await shot(p, 'admin-portal-link');
    { const url = (await p.getByTestId('portal-url').textContent()).trim(); const q = await c.newPage(); await q.goto(url); await q.getByTestId('portal-site').waitFor(); await q.waitForTimeout(400); await shot(q, 'client-portal');
      await q.evaluate(() => window.scrollTo(0, 900)); await shot(q, 'client-portal-reports'); await q.close(); }
    await p.goto(BASE + 'a/people'); await p.getByTestId('member-row').first().waitFor(); await shot(p, 'admin-people');
    await p.getByTestId('invite-btn').click(); await p.getByTestId('invite-site').first().click(); await shot(p, 'admin-invite-form');
    await p.getByTestId('invite-create').click(); await p.getByTestId('invite-code').waitFor(); await shot(p, 'admin-invite-code');
    await p.getByRole('button', { name: 'Done' }).click(); await p.getByTestId('member-row').filter({ hasText: 'Tasha' }).click(); await shot(p, 'admin-member');
    await p.goto(BASE + 'a/schedule'); await p.getByTestId('add-shift').waitFor(); await shot(p, 'admin-schedule');
    await p.getByTestId('add-shift').click(); await p.getByTestId('shift-sheet').waitFor(); await shot(p, 'admin-shift-sheet');
    await p.goto(BASE + 'a/settings'); await shot(p, 'admin-settings');
    await p.getByTestId('email-settings').evaluate((el) => el.scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -70)); await shot(p, 'admin-email-settings');
    await p.goto(BASE + 'a/settings/categories'); await p.getByTestId('category-row').first().waitFor(); await shot(p, 'admin-categories');
    await p.getByTestId('category-edit').nth(5).click(); await p.getByTestId('category-sheet').waitFor(); await shot(p, 'admin-category-edit');
    await p.goto(BASE + 'a/more'); await shot(p, 'admin-more');
    await c.close();
  }
  // client
  {
    const { c, p } = await signIn();
    await p.getByTestId('try-demo').click(); await p.getByTestId('demo-manager').click();
    await p.getByText('Trespasser at loading dock').waitFor(); await p.waitForTimeout(500); await shot(p, 'client-home');
    await p.getByTestId('client-incident').filter({ hasText: 'Graffiti' }).click(); await shot(p, 'client-incident');
    await c.close();
  }
  await browser.close();
} finally {
  server.kill();
}
