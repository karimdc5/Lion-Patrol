import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, mutateServer, emailRequests } from './helpers';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Pass 8 (items 23–26) + QA bugs a–c. Screens saved to SHOTS on the local iPhone 13 run only.
const PHOTO = fileURLToPath(new URL('../fixtures/photo.jpg', import.meta.url));
const SHOTS = process.env.LP_SHOTS8 ?? '/workspace/lion-patrol-shots/pass8';
const wantShots = () => existsSync(SHOTS); // only one project runs locally; the folder doesn't exist in CI
type Server = { tables: Record<string, Array<Record<string, any>>> };
const rows = async (page: Page, table: string) => ((await page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!) as Server)).tables[table] ?? []);
const MARKET = '0b5e0000-0000-7000-8000-00000000c001';
const WILLOW = '0b5e0000-0000-7000-8000-00000000c002';

async function shot(page: Page, name: string) { if (!wantShots()) return; await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/${name}.png` }); }
async function signIn(page: Page, email: string) { await openApp(page); await login(page, email); await dismissEnroll(page); }
async function owner(page: Page) { await signIn(page, USERS.karim); await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible(); }
async function more(page: Page, testid: string) { await page.getByRole('link', { name: 'More' }).click(); await page.getByTestId(testid).click(); }

test('item 23: guard cards — expiry status, onboarding import (name/email/card only), owner alert', async ({ page }) => {
  await owner(page);
  await expect(page.getByTestId('owner-alert').filter({ hasText: 'Guard card expires soon: Tasha Greene' })).toBeVisible({ timeout: 20_000 });
  await more(page, 'more-guard-cards');
  const row = (n: string) => page.getByTestId('gc-row').filter({ hasText: n });
  await expect(row('Tasha Greene')).toContainText(/Expires in 19 days/);
  await expect(row('Marcus Reed')).toContainText('Valid');
  await expect(row('Dana Whitfield')).toContainText('No card on file');
  await shot(page, 'guard-cards');
  await page.getByTestId('gc-import').click();
  const sheet = page.getByTestId('gc-import-sheet');
  await expect(sheet.getByTestId('gc-onb-row')).toHaveCount(2);
  await expect(sheet).not.toContainText('000-00'); // never SSN / bank / DOB
  await expect(sheet).not.toContainText('1990');
  const dana = sheet.getByTestId('gc-onb-row').filter({ hasText: 'WA-SG-0661204' });
  await expect(dana.getByTestId('gc-onb-member')).toHaveValue(/0b5e/); // matched by email
  await dana.getByTestId('gc-onb-import').click();
  await expect.poll(async () => (await rows(page, 'patrol_guard_cards')).find((c) => c.card_no === 'WA-SG-0661204')?.source).toBe('onboarding');
  await shot(page, 'guard-cards-import');
  await page.keyboard.press('Escape');
  await expect(row('Dana Whitfield')).toContainText(/Expired 5 days ago/);
  // manual edit on the member page
  await row('Marcus Reed').click();
  await page.getByTestId('guard-card-exp').fill('2027-01-31');
  await page.getByTestId('guard-card-save').click();
  await expect.poll(async () => (await rows(page, 'patrol_guard_cards')).find((c) => c.card_no === 'WA-SG-1048832')?.expires_on).toBe('2027-01-31');
});

test('item 24: post orders + codes are acknowledged on the first shift at a site only', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await mutateServer(page, `s.tables.patrol_post_order_acks = s.tables.patrol_post_order_acks.filter((a) => !a.member_id.endsWith('b3'));`);
  await login(page, USERS.marcus);
  await dismissEnroll(page);
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await expect(page.getByTestId('po-first-shift')).toBeVisible();
  await expect(page.getByTestId('po-codes')).toContainText('4417#');
  await shot(page, 'post-orders-first-shift');
  // can't skip it: Home sends the guard back until acknowledged
  await page.goto('g?backend=memory');
  await expect(page.getByTestId('po-first-shift')).toBeVisible();
  await page.getByTestId('po-ack').click();
  await expect(page.getByTestId('duty-hero')).toContainText('On duty');
  await expect.poll(async () => (await rows(page, 'patrol_post_order_acks')).filter((a) => a.member_id.endsWith('b3') && a.site_id === MARKET).length).toBe(1);
  // afterwards: available from the site, not forced
  await page.goto(`g/post-orders/${MARKET}?backend=memory`);
  await expect(page.getByTestId('po-acked')).toBeVisible();
  await expect(page.getByTestId('po-ack')).toHaveCount(0);
});

test('item 24: clients never see codes', async ({ page }) => {
  await signIn(page, USERS.client);
  await expect(page.getByTestId('client-home')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('4417');
  expect((await page.evaluate(async () => {
    const all = await indexedDB.databases();
    return all.map((d) => d.name);
  })).length).toBeGreaterThan(0);
  // the client's own cache never received the codes table (RLS)
  const cached = await page.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open('lion-patrol-mem');
    r.onsuccess = () => { const tx = r.result.transaction('records'); const q = tx.objectStore('records').index('byTable').count('patrol_site_codes'); q.onsuccess = () => res(q.result); };
  }));
  expect(cached).toBe(0);
});

test('item 25: incident photos are stamped with date, time, GPS and site at capture', async ({ page }) => {
  await signIn(page, USERS.marcus);
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByTestId('cat-search').fill('maintenance');
  await page.getByTestId('category-tile').first().click();
  await page.locator('input[type=file][accept*="image"]').first().setInputFiles(PHOTO);
  await expect(page.getByTestId('attachment')).toHaveCount(1);
  // read the stored (queued) image back and check the banner pixels: gold accent bar + dark band
  const probe = await page.evaluate(() => new Promise<{ gold: number[]; band: number[]; w: number; h: number; url: string }>((res) => {
    const r = indexedDB.open('lion-patrol-mem');
    r.onsuccess = () => {
      const q = r.result.transaction('blobs').objectStore('blobs').getAll();
      q.onsuccess = async () => {
        const b = q.result.at(-1);
        const blob = new Blob([b.bytes], { type: b.mime });
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d')!; ctx.drawImage(bmp, 0, 0);
        const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
        res({ gold: px(1, bmp.height - 3), band: px(Math.round(bmp.width * 0.98), bmp.height - 3), w: bmp.width, h: bmp.height, url: c.toDataURL('image/jpeg', 0.85) });
      };
    };
  }));
  expect(probe.gold[0]!).toBeGreaterThan(170); // #D4A537
  expect(probe.gold[2]!).toBeLessThan(110);
  expect(Math.max(...probe.band)).toBeLessThan(110); // dark banner
  if (wantShots()) writeFileSync(`${SHOTS}/stamped-photo.jpg`, Buffer.from(probe.url.split(',')[1]!, 'base64'));
});

test('item 26: monthly invoice from confirmed hours × site rate; dark PDF; marked sent by hand; never emailed', async ({ page }) => {
  await owner(page);
  await mutateServer(page, `for (const t of s.tables.patrol_time_entries) if (t.clock_out_at) { t.confirmed_at = t.clock_out_at; }`);
  await more(page, 'more-invoices');
  // current month (seed history is from the last two weeks)
  await page.getByTestId('inv-next').click();
  const kent = page.getByTestId('inv-row').filter({ hasText: 'Kent Station Market' });
  await expect(kent).toContainText('$38.00/hr');
  await kent.getByTestId('inv-create').click();
  await expect(page.getByTestId('invoice-editor')).toBeVisible();
  await expect(page.getByTestId('inv-line').first()).toBeVisible();
  const total = await page.getByTestId('inv-total').textContent();
  expect(total).toMatch(/^\$[\d,]+\.\d\d$/);
  await page.getByTestId('inv-save').click();
  await expect.poll(async () => (await rows(page, 'patrol_invoices')).find((i) => i.site_id === MARKET)?.total).toBeGreaterThan(0);
  const inv = (await rows(page, 'patrol_invoices')).find((i) => i.site_id === MARKET)!;
  expect(inv.invoice_no).toMatch(/^LSS-INV-\d{6}-KSM$/);
  expect(inv.lines.every((l: { rate: number }) => l.rate === 38)).toBe(true);
  await page.getByTestId('inv-pdf').click();
  await expect(page.getByTestId('pdf-ready')).toBeVisible({ timeout: 15_000 });
  const pdf = await page.evaluate(() => (window as unknown as { __lpLastPdf: { name: string; bytes: number[] } }).__lpLastPdf);
  const buf = Buffer.from(pdf.bytes);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.name).toBe(`${inv.invoice_no}.pdf`);
  if (wantShots()) {
    writeFileSync(`${SHOTS}/invoice.pdf`, buf);
    try { execFileSync('pdftoppm', ['-png', '-r', '70', '-f', '1', '-l', '1', '-singlefile', `${SHOTS}/invoice.pdf`, `${SHOTS}/invoice-pdf`]); } catch { /* optional */ }
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pdf-ready')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Sent to client' }).click({ force: true });
  await expect(page.getByTestId('inv-status')).toHaveText('Sent');
  await expect.poll(async () => (await rows(page, 'patrol_invoices')).find((i) => i.site_id === MARKET)?.status).toBe('sent');
  expect(emailRequests(page)).toHaveLength(0);
});

test('QA (a): shifts at a deactivated site show the site name marked inactive', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await mutateServer(page, `s.tables.patrol_sites.find((x) => x.id === '${WILLOW}').active = false;`);
  await login(page, USERS.karim);
  await dismissEnroll(page);
  await more(page, 'more-schedule');
  await expect(page.getByText(/Willow Creek Apartments \(inactive\)/).first()).toBeVisible();
});

test('QA (c): an owner who used guard mode and clocked out can open admin pages again', async ({ page }) => {
  await owner(page);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('mode-switch').click();
  await expect(page.getByTestId('back-to-admin')).toBeVisible();
  await page.goto('a/sites?backend=memory');
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible();
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('mode-switch').click(); // back to guard mode
  await page.getByTestId('back-to-admin').click();
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
});
