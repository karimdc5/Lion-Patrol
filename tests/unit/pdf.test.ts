import { describe, it, expect } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildQrSheet, qrUrl, formatCode } from '../../src/pdf/qrSheet';
import { safe, wrap } from '../../src/pdf/text';

describe('QR sheet PDF', () => {
  it('builds one page per checkpoint with the logo embedded', async () => {
    const bytes = await buildQrSheet({
      orgName: 'Lion Security Services', siteName: 'Kent Station Market', siteAddress: '418 Ramsay Way, Kent', baseUrl: 'https://karimdc5.github.io/Lion-Patrol/',
      checkpoints: [
        { name: 'Front Entrance', code: 'KSM1FRNT', seq: 1 },
        { name: 'Loading Dock — Rear “B” Door', code: '7K4Q9XW2', seq: 2, instructions: 'Check the roll-up door is down and the padlock is engaged.' },
      ],
      logoPng: new Uint8Array(readFileSync('public/brand/logo-pdf.png')),
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toContain('Kent Station Market');
    expect(bytes.length).toBeGreaterThan(20_000);
    mkdirSync('artifacts/pdfs', { recursive: true });
    writeFileSync('artifacts/pdfs/qr-sheet.pdf', bytes);
  });
  it('helpers', () => {
    expect(qrUrl('https://x.test/Lion-Patrol', 'ABCD1234')).toBe('https://x.test/Lion-Patrol/q/ABCD1234');
    expect(formatCode('ABCD1234')).toBe('ABCD-1234');
    expect(safe('“Hi” → ok 🙂')).toBe('"Hi" > ok ?');
  });
  it('wraps long words', async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont('Helvetica');
    const lines = wrap('A'.repeat(200) + ' short words here', f, 10, 100);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(f.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(100);
  });
});
