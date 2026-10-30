import { describe, it, expect } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildIncidentPdf, buildDarPdf } from '../../src/pdf/report';

const logo = new Uint8Array(readFileSync('public/brand/logo-pdf.png'));
const photo = new Uint8Array(readFileSync('tests/fixtures/photo.jpg'));
const org = { name: 'Lion Security Services', phone: '(253) 555-0142', email: 'ops@lionsecurity.demo', license_no: 'WA PSA #0000-DEMO' };
const site = { name: 'Kent Station Market', address: '418 Ramsay Way, Kent, WA 98032' };
mkdirSync('artifacts/pdfs', { recursive: true });

describe('report PDFs', () => {
  it('incident report paginates a long narrative, embeds photos and has footers', async () => {
    const narrative = Array.from({ length: 9 }, (_, k) => `Paragraph ${k + 1}. During the 01:00 patrol I observed an adult male near the loading dock compactor. I identified myself as security and explained the property is closed. He gathered his belongings and walked north on Ramsay Way. I checked the dock doors, which were secure, and photographed the area. No damage was found and no further contact was made.`).join('\n\n');
    const { bytes, pages } = await buildIncidentPdf({
      org, site, logoPng: logo, includeInternal: true,
      incident: { report_no: 'LSS-KSM-2026-00041', title: 'Trespasser at loading dock', category_name: 'Trespass & Removal', subtype_name: 'Trespass warning issued', severity: 'medium', status: 'sent_to_client', occurred_at: '2026-10-24T08:06:00Z', submitted_at: '2026-10-24T08:20:00Z', author_name: 'Marcus Reed', location_text: 'Rear loading dock', lat: 47.38236, lng: -122.23446, description: narrative, police_called: true, police_agency: 'Kent PD', police_case_no: '26-118842', people: [{ role: 'subject', name: 'Unknown', description: 'Adult male, about 40, grey hoodie, dark jeans, black backpack', phone: '' }, { role: 'witness', name: 'Priya Natarajan', description: 'Store manager, arrived 01:30', phone: '(253) 555-0188' }], vehicles: [{ plate: 'BXR4123', state: 'WA', make: 'Toyota', model: 'Camry', color: 'Grey', notes: 'Left northbound' }], review_notes: 'Checked camera footage.' },
      photos: [{ bytes: photo, mime: 'image/jpeg', caption: 'Photo 1 · 1:07 AM · loading dock' }, { bytes: photo, mime: 'image/jpeg', caption: 'Photo 2 · 1:09 AM' }, { bytes: photo, mime: 'image/jpeg', caption: 'Photo 3 · 1:12 AM' }],
      otherMedia: ['Voice note · 0:42', 'Video · 0:18'],
      events: [{ at: '2026-10-24T08:20:00Z', actor: 'Marcus Reed', text: 'Submitted' }, { at: '2026-10-24T15:00:00Z', actor: 'Karim Daher', text: 'Status → Reviewed' }, { at: '2026-10-24T15:05:00Z', actor: 'Karim Daher', text: 'Status → Sent to client' }],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pages).toBeGreaterThanOrEqual(3);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toContain('LSS-KSM-2026-00041');
    writeFileSync('artifacts/pdfs/incident-report.pdf', bytes);
  });

  it('DAR lists entries, tours with missed/late, incidents', async () => {
    const { bytes, pages } = await buildDarPdf({
      org, site, logoPng: logo,
      dar: { report_no: 'LSS-KSM-2026-00040', report_date: '2026-10-23', status: 'submitted', author_name: 'Marcus Reed', summary: 'Quiet night. One trespass warning at the loading dock, east fire exit found unlatched and secured.' },
      shift: { clock_in: '2026-10-24T05:00:00Z', clock_out: '2026-10-24T13:00:00Z', note: null },
      entries: Array.from({ length: 14 }, (_, k) => ({ at: new Date(Date.parse('2026-10-24T05:05:00Z') + k * 33 * 60e3).toISOString(), category: k % 3 ? 'Shift Log' : 'Access & Doors', body: k === 4 ? 'East side fire exit found unlatched. Secured it and notified the store manager by text message; she confirmed receipt.' : 'All exterior doors checked and locked.' })),
      tours: [
        { started: '2026-10-24T06:00:00Z', completed: '2026-10-24T06:20:00Z', expected: 4, scanned: 4, missed: [], scans: ['Front Entrance', 'East Side Fire Exit', 'Loading Dock', 'Dumpster Enclosure'].map((c, k) => ({ at: new Date(Date.parse('2026-10-24T06:00:00Z') + k * 5 * 60e3).toISOString(), checkpoint: c, flags: k === 3 ? ['late'] : [] })) },
        { started: '2026-10-24T08:30:00Z', completed: null, expected: 4, scanned: 3, missed: ['Dumpster Enclosure'], scans: ['Front Entrance', 'East Side Fire Exit', 'Loading Dock'].map((c, k) => ({ at: new Date(Date.parse('2026-10-24T08:30:00Z') + k * 6 * 60e3).toISOString(), checkpoint: c, flags: [] })) },
      ],
      incidents: [{ report_no: 'LSS-KSM-2026-00041', title: 'Trespasser at loading dock', at: '2026-10-24T08:06:00Z', severity: 'low', status: 'sent_to_client' }],
      photos: [{ bytes: photo, mime: 'image/jpeg', caption: 'East fire exit · 6:24 AM' }],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pages).toBeGreaterThanOrEqual(2);
    writeFileSync('artifacts/pdfs/dar-report.pdf', bytes);
  });
});
