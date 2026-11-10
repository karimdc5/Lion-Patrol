import { test, expect } from '@playwright/test';
import { openApp, login, enterPin, USERS } from './helpers';

async function enroll(page: import('@playwright/test').Page, pin: string) {
  await page.getByTestId('enroll-yes').click();
  await enterPin(page, pin, 'enroll-pin');
  await page.getByTestId('enroll-pin').locator('[data-key="ok"]').click();
  await enterPin(page, pin, 'enroll-confirm');
  await expect(page.getByTestId('enroll-sheet')).toHaveCount(0);
}

test('remember device with a PIN, lock, wrong PIN, unlock; PIN required after reload', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.marcus);
  await enroll(page, '2468');
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();

  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('row-lock').click();
  await expect(page.getByText('Enter your PIN')).toBeVisible();

  await enterPin(page, '1111');
  await page.getByTestId('pin').locator('[data-key="ok"]').click();
  await expect(page.getByRole('alert')).toContainText('Wrong PIN');

  await enterPin(page, '2468');
  await page.getByTestId('pin').locator('[data-key="ok"]').click();
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Enter your PIN')).toBeVisible();
  await enterPin(page, '2468');
  await page.getByTestId('pin').locator('[data-key="ok"]').click();
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
});

test('two guards share one phone and switch with their own PINs', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.marcus);
  await enroll(page, '2468');
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('row-switch').click();
  await expect(page.getByText('Who’s on duty?')).toBeVisible();

  await page.getByRole('button', { name: 'Add guard / use password' }).click();
  await login(page, USERS.karim);
  await enroll(page, '1357');
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();

  await page.getByRole('link', { name: 'More' }).click(); // in-app (a full reload would lock, by design)
  await page.getByTestId('row-switch').click();
  await expect(page.getByTestId('guard-tiles').locator('button')).toHaveCount(2);
  await page.getByTestId(`guard-tile-${USERS.marcus}`).click();
  await enterPin(page, '1357');
  await page.getByTestId('pin').locator('[data-key="ok"]').click();
  await expect(page.getByRole('alert')).toContainText('Wrong PIN');
  await enterPin(page, '2468');
  await page.getByTestId('pin').locator('[data-key="ok"]').click();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Enter your PIN')).toBeVisible();
  await page.getByRole('button', { name: 'Switch guard' }).click();
  await page.getByTestId(`guard-tile-${USERS.karim}`).click();
  await enterPin(page, '1357');
  await page.getByTestId('pin').locator('[data-key="ok"]').click();
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
});
