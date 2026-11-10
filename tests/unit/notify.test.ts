import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertOwnerRecipients, buildEmail } from '../../src/notify/emailjs';
import { CLIENT_NOTIFICATIONS_ENABLED, EMAIL_TESTING_OWNERS_ONLY } from '../../src/config';

describe('owner email notifications', () => {
  it('client notifications are hard-disabled and testing guard is on', () => {
    expect(CLIENT_NOTIFICATIONS_ENABLED).toBe(false);
    expect(EMAIL_TESTING_OWNERS_ONLY).toBe(true);
  });
  it('rejects any non-owner recipient and empty lists', () => {
    expect(() => assertOwnerRecipients(['owner@x.com', 'client@store.com'], ['owner@x.com'])).toThrow(/non-owner/);
    expect(() => assertOwnerRecipients([], [])).toThrow();
    expect(() => assertOwnerRecipients(['Owner@X.com'], ['owner@x.com'])).not.toThrow();
  });
  it('builds incident and SOS emails with report number, site and link', () => {
    const inc = buildEmail({ event: 'incident', id: 'i1', orgId: 'o' }, { id: 'i1', report_no: 'LSS-KSM-2026-00042', category_name: 'Theft & Shoplifting', title: 'Bottles taken', severity: 'high', author_name: 'Marcus Reed', occurred_at: '2026-10-24T08:00:00Z', description: 'Two bottles' }, 'Kent Station Market', ['a@x.com', 'b@x.com']);
    expect(inc.to_email).toBe('a@x.com,b@x.com');
    expect(inc.subject).toBe('[Lion Patrol] Incident LSS-KSM-2026-00042 — Theft & Shoplifting at Kent Station Market');
    expect(inc.message).toContain('/a/incidents/i1');
    const sos = buildEmail({ event: 'sos', id: 's1', orgId: 'o' }, { member_name: 'Tasha Greene', triggered_at: '2026-10-24T08:00:00Z', lat: 47.3, lng: -122.3 }, 'Willow Creek Apartments', ['a@x.com']);
    expect(sos.subject).toBe('SOS — Tasha Greene at Willow Creek Apartments');
    expect(sos.message).toContain('maps.apple.com/?q=47.3,-122.3');
  });
});

describe('source hygiene', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
  walk('src');
  it('never calls window.print()', () => {
    const offenders = files.filter((f) => /\bprint\s*\(/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')) && /window\.print|\bprint\(\)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('contains no service-role or private keys', () => {
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/service_role|sb_secret_|-----BEGIN (RSA )?PRIVATE KEY/);
  });
});
