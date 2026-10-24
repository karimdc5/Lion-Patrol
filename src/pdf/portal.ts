import { COMPANY_NAME } from '../config';
import type { Row } from '../data/db';

async function logo(): Promise<Uint8Array | null> {
  try { return new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}brand/logo-pdf.png`)).arrayBuffer()); } catch { return null; }
}

/** Build PDFs from the anonymous client-portal payload (no photos: signed media needs a signed-in user). */
export async function buildFromPortal(kind: 'incident' | 'dar', portal: { org: Row; site: Row; incidents: Row[]; dars: Row[] }, id: string) {
  const org = { name: String(portal.org.name ?? COMPANY_NAME), phone: (portal.org.phone as string) ?? null, email: (portal.org.email as string) ?? null, license_no: (portal.org.license_no as string) ?? null };
  const site = { name: String(portal.site.name), address: [portal.site.address, portal.site.city, portal.site.state].filter(Boolean).join(', ') || null };
  const { buildIncidentPdf, buildDarPdf } = await import('./report');
  if (kind === 'incident') {
    const inc = portal.incidents.find((i) => i.id === id)!;
    const r = await buildIncidentPdf({ org, site, logoPng: await logo(), incident: inc, includeInternal: false, photos: [], otherMedia: [], events: inc.submitted_at ? [{ at: String(inc.submitted_at), actor: String(inc.author_name ?? ''), text: 'Submitted' }] : [] });
    return { ...r, filename: `${String(inc.report_no ?? 'Incident')}.pdf` };
  }
  const d = portal.dars.find((x) => x.id === id)!;
  const r = await buildDarPdf({
    org, site, logoPng: await logo(),
    dar: { report_no: (d.report_no as string) ?? null, report_date: String(d.report_date), status: String(d.status), author_name: String(d.author_name ?? ''), summary: (d.summary as string) ?? null },
    shift: null, entries: ((d.entries as Row[]) ?? []).map((e) => ({ at: String(e.occurred_at), category: (e.category_name as string) ?? null, body: String(e.body) })),
    tours: ((d.tours as Row[]) ?? []).map((t) => ({ started: String(t.started_at), completed: (t.completed_at as string) ?? null, expected: Number(t.expected_count ?? 0), scanned: Number(t.scanned_count ?? 0), scans: [], missed: [] })),
    incidents: [], photos: [],
  });
  return { ...r, filename: `DAR-${String(d.report_no ?? d.report_date)}.pdf` };
}
