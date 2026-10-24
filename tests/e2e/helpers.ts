import { expect, type Page, type BrowserContext } from '@playwright/test';

export const PASSWORD = 'demo1234';
export const USERS = {
  karim: 'karim@lionsecurity.demo',
  marcus: 'marcus@lionsecurity.demo',
  dana: 'dana@lionsecurity.demo',
  client: 'manager@kentstationmarket.demo',
};

/** Open the app on the in-memory backend (demo seed), skipping the iOS install gate unless asked. */
export async function openApp(page: Page, path = '', opts: { installGate?: boolean } = {}) {
  if (!opts.installGate) await page.addInitScript(() => localStorage.setItem('lp-a2hs-dismissed', '1'));
  await page.addInitScript(() => localStorage.setItem('lp-fast-backoff', '1'));
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}backend=memory`);
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function dismissEnroll(page: Page) {
  const no = page.getByTestId('enroll-no');
  await no.waitFor({ state: 'visible' });
  await no.click();
  await expect(page.getByTestId('enroll-sheet')).toHaveCount(0);
}

export async function enterPin(page: Page, pin: string, scope = 'pin') {
  const pad = page.getByTestId(scope);
  for (const d of pin) await pad.locator(`[data-key="${d}"]`).click();
}

export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // reload once so the page is controlled by the SW (precache in place)
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });
}

/** Read/modify the mock server state (localStorage) from the test. */
export async function mutateServer(page: Page, fn: string) {
  await page.evaluate((src) => {
    const s = JSON.parse(localStorage.getItem('lp-mock-server')!);
    // eslint-disable-next-line no-new-func
    new Function('s', src)(s);
    localStorage.setItem('lp-mock-server', JSON.stringify(s));
  }, fn);
}

export async function setOffline(context: BrowserContext, page: Page, offline: boolean) {
  await context.setOffline(offline);
  await page.evaluate((o) => { (window as unknown as { __lpMock?: { offline: boolean } }).__lpMock && ((window as unknown as { __lpMock: { offline: boolean } }).__lpMock.offline = o); window.dispatchEvent(new Event(o ? 'offline' : 'online')); }, offline);
}

import { test as base } from '@playwright/test';
base.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const st = await page.evaluate(() => document.documentElement.dataset.lp + ' html=' + document.getElementById('app')?.innerHTML.slice(0, 300)).catch(() => 'n/a');
    console.log('APPSTATE', info.title, st);
  }
});
