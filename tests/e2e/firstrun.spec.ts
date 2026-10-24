import { test, expect } from '@playwright/test';
import { openApp, dismissEnroll } from './helpers';

test('owner first run: create org → default categories → site → checkpoint → invite guard (checklist guides each step)', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lp-mock-server')!);
    s.users.push({ id: 'karim-real', email: 'karim@realco.test', password: 'demo1234' });
    s.appAdmins.push('karim-real');
    localStorage.setItem('lp-mock-server', JSON.stringify(s));
  });
  await page.getByLabel('Email').fill('karim@realco.test');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your company' })).toBeVisible();
  await expect(page.getByLabel('Company name')).toHaveValue('Lion Security Services');
  await page.getByLabel('Your name (as shown on reports)').fill('Karim');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await dismissEnroll(page);
  const checklist = page.getByTestId('getting-started');
  await expect(checklist).toBeVisible();
  await expect(page.getByText('No sites yet')).toBeVisible();
  // categories seeded (20–30)
  const cats = await page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!).tables.patrol_categories.filter((c: { org_id: string }) => c.org_id !== '0b5e0000-0000-7000-8000-000000000001').length);
  expect(cats).toBeGreaterThanOrEqual(20);
  expect(cats).toBeLessThanOrEqual(30);
  // step 1: site
  await page.getByTestId('setup-step-0').click();
  await page.getByTestId('site-name').fill('Kent Station Market');
  await page.getByTestId('site-code').fill('KSM');
  await page.getByTestId('site-save').click();
  // step 2: checkpoint
  await page.getByTestId('site-tab-checkpoints').click();
  await page.getByTestId('add-checkpoint').click();
  await page.getByTestId('cp-name').fill('Front Entrance');
  await page.getByTestId('cp-save').click();
  await expect(page.getByTestId('cp-admin-row')).toHaveCount(1);
  // step 3: invite
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Live' }).click();
  await expect(page.getByTestId('setup-step-0')).toContainText('Add your first client site');
  await page.getByTestId('setup-step-2').click();
  await page.getByTestId('invite-btn').click();
  await page.getByTestId('invite-site').first().click();
  await page.getByTestId('invite-create').click();
  await expect(page.getByTestId('invite-code')).toHaveText(/^LION-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test('new account that is not an owner is guided to an invite code', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('owner-signup').click();
  await page.getByLabel('Your full name').fill('Someone New');
  await page.getByLabel('Email').fill('someone@new.test');
  await page.getByLabel('Create a password').fill('long-enough-pw');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Almost there' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter invite code' })).toBeVisible();
});
