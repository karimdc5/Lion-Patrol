import { test, expect } from '@playwright/test';
import { openApp } from './helpers';

test('boots to a branded login screen with iOS meta tags', async ({ page }) => {
  await openApp(page);
  await expect(page.getByText('LION SECURITY SERVICES')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black-translucent');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  expect(await page.locator('link[rel="apple-touch-startup-image"]').count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  // inputs are ≥16px so iOS doesn't zoom
  const fs = await page.getByLabel('Email').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fs).toBeGreaterThanOrEqual(16);
});

test('legacy single-file app is still served', async ({ page }) => {
  const res = await page.goto('legacy/index.html');
  expect(res?.status()).toBe(200);
});

test('shows the Add to Home Screen guide on iPhone Safari (not standalone)', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'iOS-only guide');
  await openApp(page, '', { installGate: true });
  await expect(page.getByTestId('install-guide')).toBeVisible();
  await expect(page.getByText('The Home Screen app has its own storage.')).toBeVisible();
  await page.getByTestId('install-continue').click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
