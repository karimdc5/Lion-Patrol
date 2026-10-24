import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, emailRequests } from './helpers';
import { mkdirSync, writeFileSync } from 'node:fs';

type Server = { tables: Record<string, Array<Record<string, any>>> };
const rows = async (page: Page, table: string) => ((await page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!) as Server)).tables[table] ?? []);

async function lastPdf(page: Page, name: string) {
  await expect(page.getByTestId('pdf-ready')).toBeVisible({ timeout: 15_000 });
  const pdf = await page.evaluate(() => (window as unknown as { __lpLastPdf: { name: string; bytes: number[] } }).__lpLastPdf);
  const buf = Buffer.from(pdf.bytes);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(8_000);
  expect(pdf.name).toMatch(/\.pdf$/);
  await expect(page.getByTestId('pdf-download')).toHaveAttribute('download', pdf.name);
  mkdirSync('artifacts/pdfs', { recursive: true });
  writeFileSync(`artifacts/pdfs/e2e-${name}-${test.info().project.name}.pdf`, buf);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as unknown as { __lpLastPdf?: unknown }).__lpLastPdf = undefined; });
  return buf;
}
async function signIn(page: Page, email: string) { await openApp(page); await login(page, email); await dismissEnroll(page); }

test('admin: incident PDF (internal + client) and DAR PDF', async ({ page }) => {
  await signIn(page, USERS.karim);
  await page.getByRole('link', { name: 'Incidents' }).click();
  await page.getByRole('tab', { name: /Sent/ }).click();
  await page.getByTestId('incident-row').filter({ hasText: 'Graffiti on east wall' }).click();
  await page.getByTestId('incident-pdf').click();
  await lastPdf(page, 'incident-admin');
  await page.getByTestId('incident-pdf-client').click();
  await lastPdf(page, 'incident-client-copy');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('more-dars').click();
  await page.getByTestId('dar-row').first().getByTestId('dar-pdf').click();
  await lastPdf(page, 'dar-admin');
});

test('guard: own incident PDF and own shift DAR PDF', async ({ page }) => {
  await signIn(page, USERS.marcus);
  await page.getByRole('link', { name: 'Activity' }).click();
  await page.getByTestId('activity-item').filter({ hasText: 'Trespasser at loading dock' }).click();
  await page.getByTestId('guard-incident-pdf').click();
  await lastPdf(page, 'incident-guard');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('activity-item').filter({ hasText: 'Clocked out' }).first().click();
  await page.getByTestId('guard-dar-pdf').click();
  await lastPdf(page, 'dar-guard');
});

test('client: incident and DAR PDFs for their own site', async ({ page }) => {
  await signIn(page, USERS.client);
  await page.getByTestId('client-incident').filter({ hasText: 'Graffiti' }).click();
  await page.getByTestId('client-incident-pdf').click();
  await lastPdf(page, 'incident-client');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('client-dar').first().click();
  await page.getByTestId('client-dar-pdf').click();
  await lastPdf(page, 'dar-client');
});

test('client portal link: own site, client-visible only, no internal notes; revoke stops it', async ({ page, context }) => {
  await signIn(page, USERS.karim);
  // add an internal note to a shared incident to prove it never leaks
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lp-mock-server')!);
    const i = s.tables.patrol_incidents.find((x: { title: string }) => x.title === 'Graffiti on east wall');
    i.review_notes = 'INTERNAL-ONLY-NOTE do not share';
    localStorage.setItem('lp-mock-server', JSON.stringify(s));
  });
  await page.getByRole('link', { name: 'Sites' }).click();
  await page.getByTestId('site-admin-row').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('site-tab-portal').click();
  await page.getByTestId('portal-create').click();
  const url = (await page.getByTestId('portal-url').textContent())!.trim();
  expect(url).toMatch(/\/p\/[0-9a-f]{20,}$/);
  const portal = await context.newPage();
  await portal.goto(url);
  await expect(portal.getByTestId('portal-site')).toHaveText('Kent Station Market');
  await expect(portal.getByTestId('portal-incident')).toHaveCount(2);
  await expect(portal.getByText('Trespasser at loading dock')).toBeVisible();
  await expect(portal.getByText('Vehicle idling behind loading dock')).toHaveCount(0);   // internal (not shared)
  await expect(portal.getByText('Vehicle blocking fire lane')).toHaveCount(0);           // other site
  await expect(portal.getByText(/INTERNAL-ONLY-NOTE/)).toHaveCount(0);
  await expect(portal.locator('.tabbar')).toHaveCount(0);
  await expect(portal.getByTestId('portal-dar').first()).toBeVisible();
  await portal.getByTestId('portal-incident').filter({ hasText: 'Graffiti' }).getByTestId('portal-incident-pdf').click();
  const buf = await lastPdf(portal, 'portal-incident');
  expect(buf.toString('latin1')).not.toContain('INTERNAL-ONLY-NOTE');
  await page.getByTestId('portal-revoke').first().click();
  await expect(page.getByTestId('portal-link-row')).toHaveCount(0);
  await portal.reload();
  await expect(portal.getByText('This link is no longer active')).toBeVisible();
});

test('email: owners-only guard in settings; incident + SOS emails go only to owners (stubbed)', async ({ page }) => {
  await signIn(page, USERS.karim);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('more-settings').click();
  await expect(page.getByTestId('testing-guard')).toContainText('Testing: owners only');
  await page.getByRole('switch', { name: 'Email notifications' }).click({ force: true });
  await page.getByTestId('recipient-input').fill('manager@kentstationmarket.demo');
  await page.getByTestId('recipient-add').click();
  await expect(page.getByText('only owner or admin account emails')).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_org_settings'))[0]!.email_enabled).toBe(true);
  // owner works a post: guard mode → high-severity theft report
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('mode-switch').click();
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByTestId('cat-search').fill('theft');
  await page.getByTestId('category-tile').first().click();
  await page.getByTestId('inc-description').fill('Two bottles of liquor concealed in a backpack; subject left through the front doors.');
  await page.getByTestId('add-person').click();
  await page.getByTestId('person-name').fill('Unknown male');
  await page.getByTestId('inc-submit').click();
  await expect.poll(() => emailRequests(page).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const first = emailRequests(page)[0]!;
  expect(first.service_id).toBe('service_49ltt4f');
  expect(first.template_id).toBe('template_n369iwa');
  expect(first.user_id).toBe('hF1r9AflJq5A0MSR6');
  const to = String(first.template_params.to_email).split(',').sort();
  expect(to).toEqual(['abdinasir@lionsecurity.demo', 'karim@lionsecurity.demo']);
  expect(first.template_params.subject).toMatch(/^\[Lion Patrol\] Incident LSS-KSM-\d{4}-\d{5} — Theft & Shoplifting at Kent Station Market$/);
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).find((i) => i.description?.startsWith('Two bottles of liquor'))?.notified_at).toBeTruthy();
  // SOS
  const sos = page.getByTestId('home-sos');
  await page.getByRole('link', { name: 'Home' }).click();
  await sos.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = (await sos.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(2300); await page.mouse.up();
  await expect.poll(() => emailRequests(page).length, { timeout: 20_000 }).toBe(2);
  const second = emailRequests(page)[1]!;
  expect(second.template_params.subject).toMatch(/^SOS — Karim Daher at /);
  for (const r of emailRequests(page)) expect(String(r.template_params.to_email)).not.toMatch(/kentstationmarket|willowcreek/);
});

test('no email is sent when notifications are off (default)', async ({ page }) => {
  await signIn(page, USERS.marcus);
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByTestId('cat-search').fill('theft');
  await page.getByTestId('category-tile').first().click();
  await page.getByTestId('inc-description').fill('Shoplifting attempt, subject dropped items and left.');
  await page.getByTestId('add-person').click();
  await page.getByTestId('person-name').fill('Unknown');
  await page.getByTestId('inc-submit').click();
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).some((i) => i.description?.startsWith('Shoplifting attempt') && i.status === 'submitted')).toBe(true);
  await page.waitForTimeout(1500);
  expect(emailRequests(page)).toHaveLength(0);
});
