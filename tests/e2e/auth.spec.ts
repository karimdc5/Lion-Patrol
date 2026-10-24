import { test, expect } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, waitForServiceWorker, setOffline } from './helpers';

test('guard signs in, stays signed in after reload, and cold-starts offline from cache', async ({ page, context }) => {
  await openApp(page);
  await login(page, USERS.marcus);
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
  await expect(page.getByTestId('site-row')).toHaveCount(2);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);

  await waitForServiceWorker(page);
  await setOffline(context, page, true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
  await expect(page.getByTestId('site-row').first()).toBeVisible();
  await expect(page.getByTestId('sync-pill')).toContainText('Offline');
  // post orders are readable offline
  await page.getByTestId('site-row').first().click();
  await expect(page.getByTestId('post-orders')).toBeVisible();
  await setOffline(context, page, false);
});

test('wrong password shows an inline error', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.marcus, 'nope-nope');
  await expect(page.getByRole('alert')).toContainText('incorrect');
});

test('owner lands in admin, switches to Guard mode and back; the choice survives reload', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.karim);
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
  await page.goto('a/more');
  await page.getByTestId('mode-switch').click();
  await expect(page.getByRole('heading', { name: 'Hi, Karim' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hi, Karim' })).toBeVisible();
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('mode-switch').click();
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
});

test('client sees only their shared reports', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.client);
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Kent Station Market' })).toBeVisible();
  await expect(page.getByText('Trespasser at loading dock')).toBeVisible();
});

test('sign out returns to login and clears the session', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.marcus);
  await dismissEnroll(page);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('row-signout').click();
  await page.getByTestId('signout-confirm').click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('new hire signs up with an invite code and lands in the guard app', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lp-mock-server')!);
    s.tables.patrol_invites = [{ id: 'inv1', org_id: '0b5e0000-0000-7000-8000-000000000001', code_plain: '7K4Q9XW2', code_hint: '9XW2', role: 'guard', site_ids: ['0b5e0000-0000-7000-8000-00000000c002'], max_uses: 1, uses: 0, expires_at: new Date(Date.now() + 864e5).toISOString() }];
    localStorage.setItem('lp-mock-server', JSON.stringify(s));
  });
  await page.getByRole('button', { name: 'Have an invite code?' }).click();
  await page.getByLabel('Invite code').fill('7k4q9xw2');
  await expect(page.getByLabel('Invite code')).toHaveValue('LION-7K4Q-9XW2');
  await page.getByLabel('Your full name').fill('Jordan Ellis');
  await page.getByLabel('Email').fill('jordan@example.com');
  await page.getByLabel('Create a password').fill('correct-horse');
  await page.getByRole('button', { name: 'Join team' }).click();
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Hi, Jordan' })).toBeVisible();
  await expect(page.getByTestId('site-row')).toHaveCount(1);
  await expect(page.getByText('Willow Creek Apartments')).toBeVisible();
});

test('app admin without an org creates one (categories seeded)', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lp-mock-server')!);
    s.users.push({ id: 'new-owner', email: 'founder@example.com', password: 'demo1234' });
    s.appAdmins.push('new-owner');
    localStorage.setItem('lp-mock-server', JSON.stringify(s));
  });
  await page.getByLabel('Email').fill('founder@example.com');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your company' })).toBeVisible();
  await page.getByLabel('Your name (as shown on reports)').fill('Founder Person');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
  await page.goto('a/settings');
  await expect(page.getByText('Theft & Shoplifting')).toBeVisible();
  await expect(page.getByText('Welfare Check (Unhoused Persons)')).toBeVisible();
});
