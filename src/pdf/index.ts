import { PUBLIC_URL, COMPANY_NAME } from '../config';
import type { Checkpoint, Site } from '../data/types';

async function logo(): Promise<Uint8Array | null> {
  try { return new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}brand/logo-pdf.png`)).arrayBuffer()); } catch { return null; }
}

export async function qrSheetPdf(site: Site, cps: Checkpoint[], orgName = COMPANY_NAME) {
  const { buildQrSheet } = await import('./qrSheet');
  const base = location.origin.includes('localhost') || location.origin.includes('127.0.0.1') ? location.origin + import.meta.env.BASE_URL : PUBLIC_URL;
  const bytes = await buildQrSheet({
    orgName, siteName: site.name, siteAddress: [site.address, site.city].filter(Boolean).join(', '), baseUrl: base,
    checkpoints: cps.map((c) => ({ name: c.name, code: c.code, seq: c.seq, instructions: c.instructions })), logoPng: await logo(),
  });
  return { bytes, pages: cps.length, filename: `QR-${(site.code || site.name).replace(/[^A-Za-z0-9]+/g, '-')}.pdf` };
}
