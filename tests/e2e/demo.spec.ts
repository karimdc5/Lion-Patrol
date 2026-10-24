import { test, expect } from '@playwright/test';

test('Try demo → pick Owner → admin dashboard, demo ribbon visible, survives reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lp-a2hs-dismissed', '1'));
  await page.goto('?demo=1');
  await page.getByTestId('try-demo').click();
  await page.getByTestId('demo-karim').click();
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
  await expect(page.locator('.demo-ribbon')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
});

test('Try demo from the normal login switches into demo mode', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lp-a2hs-dismissed', '1'));
  await page.goto('');
  await page.getByTestId('try-demo').click();
  await page.getByTestId('demo-marcus').click();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.demo-ribbon')).toBeVisible();
});
