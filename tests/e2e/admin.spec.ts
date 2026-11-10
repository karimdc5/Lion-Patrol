import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS } from './helpers';
import { mkdirSync, writeFileSync } from 'node:fs';

type Server = { tables: Record<string, Array<Record<string, any>>> };
const rows = async (page: Page, table: string) => ((await page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!) as Server)).tables[table] ?? []);

async function signInOwner(page: Page) {
  await openApp(page);
  await login(page, USERS.karim);
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
}
async function goMore(page: Page, testid: string) {
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId(testid).click();
}

test('categories: add, rename, reorder and hide flow through to the guard report grid', async ({ page }) => {
  await signInOwner(page);
  await goMore(page, 'more-settings');
  await page.getByTestId('manage-categories').click();
  await page.getByTestId('add-category').click();
  await page.getByTestId('category-name').fill('Package Theft Watch');
  await page.getByTestId('subtype-new').fill('Porch pirate');
  await page.getByTestId('category-save').click();
  const rowsLoc = page.getByTestId('category-row');
  await expect(rowsLoc.last()).toContainText('Package Theft Watch');
  // rename
  await rowsLoc.last().getByTestId('category-edit').click();
  await page.getByTestId('category-name').fill('Package Watch');
  await page.getByTestId('category-save').click();
  await expect(rowsLoc.last()).toContainText('Package Watch');
  // reorder: move it up one
  const count = await rowsLoc.count();
  await rowsLoc.last().getByTestId('category-up').click();
  await expect(rowsLoc.nth(count - 2)).toContainText('Package Watch');
  // hide "Animal"
  await rowsLoc.filter({ hasText: 'Animal' }).getByTestId('category-hide').click();
  await expect(rowsLoc.filter({ hasText: 'Animal' })).toContainText('hidden');
  await expect.poll(async () => (await rows(page, 'patrol_categories')).find((c) => c.name === 'Animal')?.hidden).toBe(true);
  await expect.poll(async () => (await rows(page, 'patrol_subtypes')).some((s) => s.name === 'Porch pirate')).toBe(true);
  // guard grid
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('mode-switch').click();
  await page.getByRole('button', { name: 'Report' }).click();
  await expect(page.getByTestId('category-tile').filter({ hasText: 'Package Watch' })).toHaveCount(1);
  await expect(page.getByTestId('category-tile').filter({ hasText: /^Animal$/ })).toHaveCount(0);
});

test('create a site and a checkpoint, then generate the QR sheet PDF', async ({ page }) => {
  await signInOwner(page);
  await page.getByRole('link', { name: 'Sites' }).click();
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-name').fill('Meridian Plaza');
  await page.getByTestId('site-code').fill('MRP');
  await page.getByTestId('site-save').click();
  await page.getByTestId('site-tab-checkpoints').click();
  await page.getByTestId('add-checkpoint').click();
  await page.getByTestId('cp-name').fill('North Lobby Door');
  await page.getByTestId('cp-save').click();
  await expect(page.getByTestId('cp-admin-row')).toHaveCount(1);
  await page.getByTestId('qr-sheet').click();
  await expect(page.getByTestId('pdf-ready')).toBeVisible();
  const pdf = await page.evaluate(() => (window as unknown as { __lpLastPdf: { name: string; bytes: number[] } }).__lpLastPdf);
  const buf = Buffer.from(pdf.bytes);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(15_000);
  expect(pdf.name).toBe('QR-MRP.pdf');
  mkdirSync('artifacts/pdfs', { recursive: true });
  writeFileSync(`artifacts/pdfs/qr-sheet-e2e-${test.info().project.name}.pdf`, buf);
  await expect.poll(async () => (await rows(page, 'patrol_checkpoints')).some((c) => c.name === 'North Lobby Door')).toBe(true);
  expect((await rows(page, 'patrol_sites')).some((s) => s.name === 'Meridian Plaza' && s.code === 'MRP')).toBe(true);
});

test('invite creates a shareable one-time code', async ({ page }) => {
  await signInOwner(page);
  await goMore(page, 'more-people');
  await page.getByTestId('invite-btn').click();
  await page.getByTestId('invite-site').first().click();
  await page.getByTestId('invite-create').click();
  await expect(page.getByTestId('invite-code')).toHaveText(/^LION-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect((await rows(page, 'patrol_invites')).length).toBeGreaterThanOrEqual(1);
});

test('schedule a shift for a guard', async ({ page }) => {
  await signInOwner(page);
  await goMore(page, 'more-schedule');
  const before = (await rows(page, 'patrol_shifts')).length;
  await page.getByTestId('add-shift').click();
  await page.getByTestId('shift-guard').selectOption({ label: 'Marcus Reed' });
  await page.getByTestId('shift-repeat').selectOption('1');
  await page.getByTestId('shift-save').click();
  await expect(page.getByTestId('shift-row').filter({ hasText: 'Marcus Reed' }).first()).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_shifts')).length).toBe(before + 2);
});

test('dashboard: on-shift guards, SOS banner, acknowledge and resolve', async ({ page }) => {
  await signInOwner(page);
  await expect(page.getByTestId('onshift-row').filter({ hasText: 'Tasha Greene' })).toBeVisible();
  await expect(page.getByTestId('onshift-row').filter({ hasText: 'Abdinasir Elmi' })).toBeVisible();
  await expect(page.getByTestId('completion-row')).toHaveCount(2);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lp-mock-server')!);
    s.tables.patrol_alerts.push({ id: 'sos-test-1', org_id: '0b5e0000-0000-7000-8000-000000000001', site_id: '0b5e0000-0000-7000-8000-00000000c002', member_id: '0b5e0000-0000-7000-8000-0000000000b6', member_name: 'Tasha Greene', triggered_at: new Date().toISOString(), lat: 47.3221, lng: -122.3127, status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    localStorage.setItem('lp-mock-server', JSON.stringify(s));
  });
  await page.reload();
  const banner = page.getByTestId('sos-banner');
  await expect(banner).toContainText('Tasha Greene');
  await expect(banner).toContainText('needs response');
  await page.getByTestId('sos-ack').click();
  await expect(banner).toContainText('acknowledged');
  await expect.poll(async () => (await rows(page, 'patrol_alerts')).find((a) => a.id === 'sos-test-1')?.status).toBe('acknowledged');
  await page.getByTestId('sos-resolve').click();
  await expect(page.getByTestId('sos-banner')).toHaveCount(0);
  await expect.poll(async () => (await rows(page, 'patrol_alerts')).find((a) => a.id === 'sos-test-1')?.status).toBe('resolved');
});

test('incident review: mark reviewed, share with client, add internal note', async ({ page }) => {
  await signInOwner(page);
  await page.getByRole('link', { name: 'Incidents' }).click();
  await page.getByTestId('incident-row').filter({ hasText: 'Vehicle idling' }).click();
  await expect(page.getByTestId('incident-review')).toContainText('Grey sedan idling');
  await page.getByTestId('status-reviewed').click();
  await page.getByRole('switch', { name: 'Visible to client' }).click({ force: true });
  await page.getByTestId('review-note').fill('Checked camera footage; plate unreadable.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).find((i) => i.title === 'Vehicle idling behind loading dock')).toMatchObject({ status: 'reviewed', client_visible: true });
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).find((i) => i.title === 'Vehicle idling behind loading dock')?.review_notes).toContain('plate unreadable');
});

test('activity feed filters by type', async ({ page }) => {
  await signInOwner(page);
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByTestId('feed-item').first()).toBeVisible();
  await page.getByTestId('feed-filters').getByRole('button', { name: 'Scans' }).click();
  const n = await page.getByTestId('feed-item').count();
  expect(n).toBeGreaterThan(0);
  for (const t of await page.getByTestId('feed-item').allTextContents()) expect(t).not.toMatch(/Clocked in/);
});

test('client sees only client-visible reports for their own site', async ({ page }) => {
  await openApp(page);
  await login(page, USERS.client);
  await dismissEnroll(page);
  await expect(page.getByTestId('client-home')).toBeVisible();
  await expect(page.getByTestId('client-incident').filter({ hasText: 'Trespasser at loading dock' })).toBeVisible();
  await expect(page.getByTestId('client-incident').filter({ hasText: 'Graffiti on east wall' })).toBeVisible();
  await expect(page.getByTestId('client-incident')).toHaveCount(2);           // not the internal Kent reports
  await expect(page.getByText('Vehicle idling behind loading dock')).toHaveCount(0);
  await expect(page.getByText('Vehicle blocking fire lane')).toHaveCount(0);   // Willow Creek (other site)
  await expect(page.getByTestId('client-dar').first()).toBeVisible();
  await page.getByTestId('client-incident').filter({ hasText: 'Graffiti' }).click();
  await expect(page.getByText('spray-paint tags')).toBeVisible();
});
