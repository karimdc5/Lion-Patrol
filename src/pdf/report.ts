import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { safe, wrap } from './text';

// ---------------------------------------------------------------- shared types
export interface OrgInfo { name: string; phone?: string | null; email?: string | null; license_no?: string | null; address?: string | null }
export interface SiteInfo { name: string; address?: string | null }
export interface PdfPhoto { bytes: Uint8Array; mime: string; caption: string }

export interface IncidentPdfInput {
  org: OrgInfo; site: SiteInfo; logoPng?: Uint8Array | null; tz?: string;
  incident: Record<string, unknown>;
  photos: PdfPhoto[];
  otherMedia: string[];
  events: Array<{ at: string; actor: string; text: string }>;
  includeInternal: boolean;
  /** Category-specific answers (label, value), e.g. "Items taken". */
  extras?: Array<[string, string]>;
}
export interface ShiftPdfInput {
  org: OrgInfo; site: SiteInfo; logoPng?: Uint8Array | null; tz?: string;
  officer: string;
  shift: { clock_in: string; clock_out?: string | null; in_gps?: string | null; out_gps?: string | null; note?: string | null; timesheet?: string | null };
  timeline: Array<{ at: string; kind: string; text: string }>;
  stats: { patrols: number; scans: number; entries: number; incidents: number; bolos: number };
  incidents: Array<{ report_no?: string | null; title: string; at: string; severity: string; category?: string | null; description: string; extras: Array<[string, string]>; photos: PdfPhoto[] }>;
  bolos: Array<{ title: string; at: string; description: string }>;
  photos: PdfPhoto[];
}
export interface DarPdfInput {
  org: OrgInfo; site: SiteInfo; logoPng?: Uint8Array | null; tz?: string;
  dar: { report_no?: string | null; report_date: string; status: string; author_name: string; summary?: string | null; submitted_at?: string | null };
  shift: { clock_in?: string | null; clock_out?: string | null; note?: string | null } | null;
  entries: Array<{ at: string; category?: string | null; body: string }>;
  tours: Array<{ started: string; completed?: string | null; expected: number; scanned: number; scans: Array<{ at: string; checkpoint: string; flags: string[] }>; missed: string[] }>;
  incidents: Array<{ report_no?: string | null; title: string; at: string; severity: string; status: string }>;
  photos: PdfPhoto[];
}

// ---------------------------------------------------------------- style
// Dark theme only (Karim's call, item 17): matches the app (#0A0F1C background, gold accents).
export const BG = rgb(0.039, 0.059, 0.11);
const INK = rgb(0.96, 0.97, 0.98);
const BODY = rgb(0.82, 0.85, 0.89);
const GREY = rgb(0.6, 0.64, 0.7);
const LIGHT = rgb(0.18, 0.22, 0.3);
const SOFT = rgb(0.08, 0.11, 0.18);
const GOLD = rgb(0.83, 0.647, 0.215);
const RED = rgb(0.95, 0.42, 0.42);
const AMBER = rgb(0.97, 0.66, 0.22);
const GREEN = rgb(0.3, 0.8, 0.48);
const W = 612, H = 792, M = 48, BOTTOM = 74, CONTENT_W = W - 2 * M;

const fmt = (iso: unknown, tz: string, withDate = true) => {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  const o: Intl.DateTimeFormatOptions = withDate ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz } : { hour: 'numeric', minute: '2-digit', timeZone: tz };
  return new Intl.DateTimeFormat('en-US', o).format(d);
};

// ---------------------------------------------------------------- layout engine
class Layout {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(public doc: PDFDocument, public f: { reg: PDFFont; bold: PDFFont; ital: PDFFont }, public logo: PDFImage | null, public title: string, public ref: string, public org: OrgInfo) {}

  private addPage() {
    this.page = this.doc.addPage([W, H]);
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: BG });
    this.pages.push(this.page);
  }

  first(subtitleRight: string) {
    this.addPage();
    let y = H - M;
    let tx = M;
    if (this.logo) {
      const h = 54, w = (this.logo.width / this.logo.height) * h;
      this.page.drawImage(this.logo, { x: M, y: y - h + 4, width: w, height: h });
      tx = M + w + 12;
    }
    this.page.drawText(safe(this.org.name.toUpperCase()), { x: tx, y: y - 14, size: 15, font: this.f.bold, color: INK });
    this.page.drawText('Licensed & Insured  ·  Unarmed Security  ·  South King County, WA', { x: tx, y: y - 29, size: 8.5, font: this.f.reg, color: GOLD });
    const contact = [this.org.phone, this.org.email, this.org.license_no].filter(Boolean).join('  ·  ');
    if (contact) this.page.drawText(safe(contact), { x: tx, y: y - 42, size: 8, font: this.f.reg, color: GREY });
    const t = safe(this.title);
    this.page.drawText(t, { x: W - M - this.f.bold.widthOfTextAtSize(t, 13), y: y - 14, size: 13, font: this.f.bold, color: INK });
    const r = safe(this.ref);
    this.page.drawText(r, { x: W - M - this.f.bold.widthOfTextAtSize(r, 10), y: y - 30, size: 10, font: this.f.bold, color: GOLD });
    const s = safe(subtitleRight);
    this.page.drawText(s, { x: W - M - this.f.reg.widthOfTextAtSize(s, 8), y: y - 43, size: 8, font: this.f.reg, color: GREY });
    this.page.drawLine({ start: { x: M, y: y - 58 }, end: { x: W - M, y: y - 58 }, thickness: 1.6, color: GOLD });
    this.y = y - 76;
  }

  newPage() {
    this.addPage();
    let x = M;
    if (this.logo) {
      const h = 22, w = (this.logo.width / this.logo.height) * h;
      this.page.drawImage(this.logo, { x: M, y: H - M - h + 6, width: w, height: h });
      x += w + 8;
    }
    this.page.drawText(safe(this.org.name.toUpperCase()), { x, y: H - M - 9, size: 9, font: this.f.bold, color: INK });
    const r = safe(`${this.title}  ·  ${this.ref}`);
    this.page.drawText(r, { x: W - M - this.f.reg.widthOfTextAtSize(r, 8.5), y: H - M - 9, size: 8.5, font: this.f.reg, color: GREY });
    this.page.drawLine({ start: { x: M, y: H - M - 22 }, end: { x: W - M, y: H - M - 22 }, thickness: 0.8, color: GOLD });
    this.y = H - M - 42;
  }

  ensure(h: number) { if (this.y - h < BOTTOM) this.newPage(); }

  section(title: string) {
    this.ensure(64);
    this.y -= 8;
    this.page.drawText(safe(title.toUpperCase()), { x: M, y: this.y, size: 9, font: this.f.bold, color: GOLD });
    this.page.drawLine({ start: { x: M, y: this.y - 5 }, end: { x: W - M, y: this.y - 5 }, thickness: 0.5, color: LIGHT });
    this.y -= 22;
  }

  paragraph(text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; lead?: number } = {}) {
    const size = opts.size ?? 10.5, font = opts.font ?? this.f.reg, lead = opts.lead ?? size * 1.45;
    const x = opts.x ?? M, width = opts.width ?? CONTENT_W;
    for (const line of wrap(text || '—', font, size, width)) {
      this.ensure(lead);
      this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? BODY });
      this.y -= lead;
    }
  }

  /** Two-column label/value grid. Each cell wraps; rows paginate as a unit. */
  grid(pairs: Array<[string, string]>, cols = 2) {
    const gap = 18, cw = (CONTENT_W - gap * (cols - 1)) / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const lines = row.map(([, v]) => wrap(v || '—', this.f.reg, 10.5, cw));
      const h = 14 + Math.max(...lines.map((l) => l.length)) * 14 + 8;
      this.ensure(h);
      row.forEach(([label], j) => {
        const x = M + j * (cw + gap);
        this.page.drawText(safe(label.toUpperCase()), { x, y: this.y, size: 7.5, font: this.f.bold, color: GREY });
        lines[j]!.forEach((ln, k) => this.page.drawText(ln, { x, y: this.y - 14 - k * 14, size: 10.5, font: this.f.reg, color: INK }));
      });
      this.y -= h;
    }
  }

  /** Simple table with header; wraps cells and repeats the header after page breaks. */
  table(headers: string[], widths: number[], rows: string[][], colors?: Array<ReturnType<typeof rgb> | undefined>) {
    const drawHeader = () => {
      this.ensure(22);
      this.page.drawRectangle({ x: M, y: this.y - 6, width: CONTENT_W, height: 18, color: SOFT });
      let x = M + 6;
      headers.forEach((h, i) => { this.page.drawText(safe(h.toUpperCase()), { x, y: this.y, size: 7.5, font: this.f.bold, color: GREY }); x += widths[i]!; });
      this.y -= 20;
    };
    drawHeader();
    rows.forEach((r, ri) => {
      const cells = r.map((c, i) => wrap(c || '—', this.f.reg, 9.5, widths[i]! - 10));
      const h = Math.max(...cells.map((c) => c.length)) * 13 + 6;
      if (this.y - h < BOTTOM) { this.newPage(); drawHeader(); }
      let x = M + 6;
      cells.forEach((lines, i) => {
        lines.forEach((ln, k) => this.page.drawText(ln, { x, y: this.y - k * 13, size: 9.5, font: i === 0 ? this.f.bold : this.f.reg, color: (i === cells.length - 1 && colors?.[ri]) || INK }));
        x += widths[i]!;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y + 4 }, end: { x: W - M, y: this.y + 4 }, thickness: 0.4, color: LIGHT });
      this.y -= 4;
    });
    this.y -= 4;
  }

  async photos(photos: PdfPhoto[]) {
    const gap = 14, cw = (CONTENT_W - gap) / 2, maxH = 190;
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      const imgs: Array<{ img: PDFImage; w: number; h: number; caption: string } | null> = [];
      for (const p of pair) {
        try {
          const img = p.mime === 'image/png' ? await this.doc.embedPng(p.bytes) : await this.doc.embedJpg(p.bytes);
          const s = Math.min(cw / img.width, maxH / img.height);
          imgs.push({ img, w: img.width * s, h: img.height * s, caption: p.caption });
        } catch { imgs.push(null); }
      }
      const rowH = Math.max(40, ...imgs.map((x) => (x ? x.h : 0))) + 22;
      this.ensure(rowH);
      imgs.forEach((x, j) => {
        const cx = M + j * (cw + gap);
        if (!x) { this.page.drawText('(image unavailable)', { x: cx, y: this.y - 20, size: 9, font: this.f.ital, color: GREY }); return; }
        this.page.drawRectangle({ x: cx, y: this.y - x.h, width: cw, height: x.h, color: SOFT });
        this.page.drawImage(x.img, { x: cx + (cw - x.w) / 2, y: this.y - x.h, width: x.w, height: x.h });
        this.page.drawText(safe(x.caption).slice(0, 70), { x: cx, y: this.y - x.h - 12, size: 8, font: this.f.reg, color: GREY });
      });
      this.y -= rowH;
    }
  }

  signatures(labels: string[]) {
    this.ensure(70);
    this.y -= 26;
    const cw = (CONTENT_W - 24) / labels.length;
    labels.forEach((l, i) => {
      const x = M + i * (cw + 24);
      this.page.drawLine({ start: { x, y: this.y }, end: { x: x + cw, y: this.y }, thickness: 0.7, color: INK });
      this.page.drawText(safe(l), { x, y: this.y - 12, size: 8.5, font: this.f.reg, color: GREY });
      this.page.drawText('Date: ______________', { x: x + cw - 92, y: this.y - 12, size: 8.5, font: this.f.reg, color: GREY });
    });
    this.y -= 30;
  }

  footers(left: string) {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: LIGHT });
      p.drawText(safe(left).slice(0, 110), { x: M, y: 36, size: 7.5, font: this.f.reg, color: GREY });
      const pn = `Page ${i + 1} of ${total}`;
      p.drawText(pn, { x: W - M - this.f.reg.widthOfTextAtSize(pn, 7.5), y: 36, size: 7.5, font: this.f.reg, color: GREY });
    });
  }
}

async function setup(title: string, ref: string, org: OrgInfo, logoPng?: Uint8Array | null) {
  const doc = await PDFDocument.create();
  doc.setAuthor(org.name); doc.setCreator('Lion Patrol'); doc.setProducer('Lion Patrol'); doc.setCreationDate(new Date());
  const f = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), ital: await doc.embedFont(StandardFonts.HelveticaOblique) };
  let logo: PDFImage | null = null;
  if (logoPng) { try { logo = await doc.embedPng(logoPng); } catch { logo = null; } }
  return { doc, L: new Layout(doc, f, logo, title, ref, org), f };
}

const cap = (s: unknown) => { const t = String(s ?? ''); return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '—'; };

// ---------------------------------------------------------------- incident report
export async function buildIncidentPdf(input: IncidentPdfInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const tz = input.tz ?? 'America/Los_Angeles';
  const i = input.incident;
  const ref = String(i.report_no ?? 'Draft');
  const { doc, L, f } = await setup('INCIDENT REPORT', ref, input.org, input.logoPng);
  doc.setTitle(`Incident report ${ref} - ${input.site.name}`);
  L.first(`Generated ${fmt(new Date().toISOString(), tz)}`);

  // title block
  L.paragraph(String(i.title || i.category_name || 'Incident'), { size: 17, font: f.bold, color: INK, lead: 22 });
  L.paragraph(`${i.category_name ?? ''}${i.subtype_name ? `  >  ${i.subtype_name}` : ''}`, { size: 10.5, color: GREY, lead: 18 });
  L.y -= 4;
  const police = i.police_called ? [i.police_agency ?? 'Police contacted', i.police_case_no ? `Case # ${i.police_case_no}` : null, i.officer_name ? `Officer ${i.officer_name}` : null].filter(Boolean).join(', ') : 'Not contacted';
  const loc = [i.location_text, i.lat != null ? `GPS ${Number(i.lat).toFixed(5)}, ${Number(i.lng).toFixed(5)}` : null].filter(Boolean).join(' · ');
  L.section('Summary');
  L.grid([
    ['Site', input.site.name], ['Address', input.site.address ?? '—'],
    ['Severity', cap(i.severity)], ['Status', cap(i.status)],
    ['Occurred', fmt(i.occurred_at, tz)], ['Reported', fmt(i.submitted_at ?? i.created_at, tz)],
    ['Reporting officer', String(i.author_name ?? '—')], ['Location', loc || '—'],
    ['Police', police], ['Fire / EMS', [i.fire_called && 'Fire department', i.ems_called && 'EMS'].filter(Boolean).join(', ') || 'Not contacted'],
    ...(i.injury || i.injury_details ? [['Injury', String(i.injury_details ?? 'Yes')] as [string, string]] : []),
    ...(i.property_damage ? [['Property damage', i.damage_estimate_usd != null ? `Estimated $${Number(i.damage_estimate_usd).toFixed(2)}` : 'Yes'] as [string, string]] : []),
  ]);
  if (input.extras?.length) { L.section(`${i.category_name ?? 'Category'} details`); L.grid(input.extras); }
  L.section('Narrative');
  for (const para of String(i.description ?? '').split(/\n{2,}/)) { L.paragraph(para); L.y -= 4; }

  const people = (i.people as Array<Record<string, string>>) ?? [];
  if (people.length) {
    L.section('People involved');
    L.table(['Role', 'Name', 'Description', 'Phone'], [80, 130, 214, 92], people.map((p) => [cap(p.role), p.name || 'Unknown', p.description || '', p.phone || '']));
  }
  const vehicles = (i.vehicles as Array<Record<string, string>>) ?? [];
  if (vehicles.length) {
    L.section('Vehicles involved');
    L.table(['Plate', 'Make / model', 'Color / notes'], [120, 200, 196], vehicles.map((v) => [`${v.plate || '—'} ${v.state ?? ''}`.trim(), [v.make, v.model].filter(Boolean).join(' '), [v.color, v.notes].filter(Boolean).join(' · ')]));
  }
  if (input.photos.length) { L.ensure(64 + 212); L.section(`Photos (${input.photos.length})`); await L.photos(input.photos); }
  if (input.otherMedia.length) { L.section('Other attachments'); for (const m of input.otherMedia) L.paragraph(`•  ${m}`, { size: 9.5 }); }
  if (input.events.length) {
    L.section('Timeline');
    L.table(['When', 'By', 'Change'], [140, 120, 256], input.events.map((e) => [fmt(e.at, tz), e.actor, e.text]));
  }
  if (input.includeInternal && i.review_notes) { L.section('Internal review notes (not for client)'); L.paragraph(String(i.review_notes), { color: RED }); }
  L.section('Certification');
  L.paragraph('I certify that the information in this report is true and accurate to the best of my knowledge.', { size: 9.5, color: GREY });
  L.signatures([`Reporting officer: ${i.author_name ?? ''}`, 'Reviewed by']);
  L.footers(`Confidential — prepared for ${input.site.name} by ${input.org.name}. Report ${ref}.`);
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
}

// ---------------------------------------------------------------- daily activity report
export async function buildDarPdf(input: DarPdfInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const tz = input.tz ?? 'America/Los_Angeles';
  const d = input.dar;
  const ref = d.report_no ?? `DAR ${d.report_date}`;
  const { doc, L, f } = await setup('DAILY ACTIVITY REPORT', ref, input.org, input.logoPng);
  doc.setTitle(`Daily activity report ${d.report_date} - ${input.site.name}`);
  L.first(`Generated ${fmt(new Date().toISOString(), tz)}`);
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.report_date}T12:00:00Z`));
  L.paragraph(`${input.site.name}`, { size: 17, font: f.bold, color: INK, lead: 22 });
  L.paragraph(dateLabel, { size: 10.5, color: GREY, lead: 18 });
  const expected = input.tours.reduce((n, t) => n + t.expected, 0);
  const scanned = input.tours.reduce((n, t) => n + Math.min(t.scanned, t.expected), 0);
  const pct = expected ? Math.round((scanned / expected) * 100) : null;
  const late = input.tours.reduce((n, t) => n + t.scans.filter((s) => s.flags.includes('late')).length, 0);
  const missed = input.tours.reduce((n, t) => n + t.missed.length, 0);
  L.section('Shift');
  L.grid([
    ['Officer', d.author_name], ['Address', input.site.address ?? '—'],
    ['Clock in', fmt(input.shift?.clock_in, tz)], ['Clock out', fmt(input.shift?.clock_out, tz)],
    ['Patrol completion', pct == null ? 'No tours logged' : `${pct}%  (${scanned} of ${expected} checkpoints)`], ['Exceptions', `${missed} missed · ${late} late`],
    ['Log entries', String(input.entries.length)], ['Incidents', String(input.incidents.length)],
  ]);
  if (d.summary || input.shift?.note) { L.section('Shift summary'); L.paragraph(String(d.summary ?? input.shift?.note)); }
  L.section('Activity log');
  if (input.entries.length) L.table(['Time', 'Category', 'Entry'], [70, 130, 316], input.entries.map((e) => [fmt(e.at, tz, false), e.category || 'Log', e.body]));
  else L.paragraph('No log entries recorded.', { color: GREY });
  if (input.tours.length) {
    L.section('Patrol tours');
    input.tours.forEach((t, k) => {
      L.ensure(40);
      L.paragraph(`Tour ${k + 1}  ·  started ${fmt(t.started, tz, false)}${t.completed ? `, completed ${fmt(t.completed, tz, false)}` : ''}  ·  ${Math.min(t.scanned, t.expected)}/${t.expected} checkpoints`, { size: 10, font: f.bold, color: INK, lead: 16 });
      const rows = [...t.scans.map((s) => [fmt(s.at, tz, false), s.checkpoint, s.flags.includes('late') ? 'Late' : s.flags.includes('out_of_order') ? 'Out of order' : s.flags.includes('off_site') ? 'Off site' : 'On time']), ...t.missed.map((m) => ['—', m, 'Missed'])];
      const colors = rows.map((r) => (r[2] === 'Missed' ? RED : r[2] === 'On time' ? GREEN : AMBER));
      L.table(['Time', 'Checkpoint', 'Result'], [80, 316, 120], rows, colors);
    });
  }
  if (input.incidents.length) {
    L.section('Incidents this shift');
    L.table(['Report #', 'Title', 'Time', 'Severity'], [140, 216, 90, 70], input.incidents.map((x) => [x.report_no ?? '—', x.title, fmt(x.at, tz, false), cap(x.severity)]));
  }
  if (input.photos.length) { L.ensure(64 + 212); L.section(`Photos (${input.photos.length})`); await L.photos(input.photos); }
  L.signatures([`Officer: ${d.author_name}`, 'Supervisor']);
  L.footers(`Confidential — daily activity report for ${input.site.name} by ${input.org.name}. ${ref}.`);
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
}

// ---------------------------------------------------------------- end-of-shift report (item 12)
export async function buildShiftPdf(input: ShiftPdfInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const tz = input.tz ?? 'America/Los_Angeles';
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }).format(new Date(input.shift.clock_in));
  const ref = `${input.officer} · ${day}`;
  const { doc, L, f } = await setup('END-OF-SHIFT REPORT', ref, input.org, input.logoPng);
  doc.setTitle(`End-of-shift report ${day} - ${input.site.name} - ${input.officer}`);
  L.first(`Generated ${fmt(new Date().toISOString(), tz)}`);
  L.paragraph(input.site.name, { size: 17, font: f.bold, color: INK, lead: 22 });
  L.paragraph(input.site.address ?? '', { size: 10.5, color: GREY, lead: 18 });
  const mins = input.shift.clock_out ? Math.round((Date.parse(input.shift.clock_out) - Date.parse(input.shift.clock_in)) / 60000) : null;
  L.section('Shift');
  L.grid([
    ['Officer', input.officer], ['Duration', mins == null ? 'On duty' : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`],
    ['Clock in', fmt(input.shift.clock_in, tz)], ['Clock out', fmt(input.shift.clock_out, tz)],
    ['Clock-in GPS', input.shift.in_gps ?? 'Not recorded'], ['Clock-out GPS', input.shift.out_gps ?? 'Not recorded'],
    ['Patrols', String(input.stats.patrols)], ['Checkpoint scans', String(input.stats.scans)],
    ['Log entries', String(input.stats.entries)], ['Incidents', String(input.stats.incidents)],
    ['BOLOs posted', String(input.stats.bolos)], ['Timesheet', input.shift.timesheet ?? 'Not confirmed'],
  ]);
  if (input.shift.note) { L.section('Shift note'); L.paragraph(input.shift.note); }
  L.section('Shift timeline');
  if (input.timeline.length) {
    L.table(['Time', 'Type', 'Detail'], [70, 100, 346], input.timeline.map((e) => [fmt(e.at, tz, false), e.kind, e.text]));
  } else L.paragraph('Nothing recorded.', { color: GREY });
  if (input.incidents.length) {
    L.section(`Incidents (${input.incidents.length})`);
    for (const x of input.incidents) {
      L.ensure(60);
      L.paragraph(`${x.report_no ? `${x.report_no}  ·  ` : ''}${x.title}`, { size: 11.5, font: f.bold, color: INK, lead: 17 });
      L.paragraph(`${x.category ?? 'Incident'}  ·  ${cap(x.severity)} severity  ·  ${fmt(x.at, tz)}`, { size: 9.5, color: GREY, lead: 15 });
      if (x.extras.length) L.grid(x.extras);
      L.paragraph(x.description || '—', { size: 10 });
      L.y -= 6;
      if (x.photos.length) await L.photos(x.photos);
      L.y -= 6;
    }
  }
  if (input.bolos.length) {
    L.section('BOLOs posted');
    L.table(['Time', 'BOLO', 'Details'], [70, 170, 276], input.bolos.map((b) => [fmt(b.at, tz, false), b.title, b.description]));
  }
  if (input.photos.length) { L.ensure(64 + 212); L.section(`Log photos (${input.photos.length})`); await L.photos(input.photos); }
  L.signatures([`Officer: ${input.officer}`, 'Supervisor']);
  L.footers(`Confidential — end-of-shift report for ${input.site.name} by ${input.org.name}.`);
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
}

// ---------------------------------------------------------------- monthly client invoice (item 26)
export interface InvoicePdfInput {
  org: OrgInfo; site: SiteInfo; logoPng?: Uint8Array | null;
  invoice: { invoice_no: string; period: string; issue_date: string; due_date: string; status: string; client_name?: string | null; bill_to?: string | null; notes?: string | null };
  lines: Array<{ date: string; guard: string; hours: number; rate: number; description?: string }>;
  payment: { note: string; details: string; terms_days: number };
}
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymdLabel = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const inv = input.invoice;
  const { doc, L, f } = await setup('INVOICE', inv.invoice_no, input.org, input.logoPng);
  doc.setTitle(`Invoice ${inv.invoice_no} - ${input.site.name}`);
  L.first(`Issued ${ymdLabel(inv.issue_date)}`);
  const hours = input.lines.reduce((n, l) => n + l.hours, 0);
  const total = Math.round(input.lines.reduce((n, l) => n + l.hours * l.rate, 0) * 100) / 100;
  L.paragraph(`Security services · ${inv.period}`, { size: 17, font: f.bold, color: INK, lead: 22 });
  L.paragraph(input.site.name + (input.site.address ? ` · ${input.site.address}` : ''), { size: 10.5, color: GREY, lead: 18 });
  L.section('Invoice');
  L.grid([
    ['Bill to', [inv.client_name, inv.bill_to].filter(Boolean).join(' · ') || input.site.name], ['Invoice number', inv.invoice_no],
    ['Service period', inv.period], ['Invoice date', ymdLabel(inv.issue_date)],
    ['Due date', ymdLabel(inv.due_date)], ['Amount due', money(total)],
  ]);
  L.section('Services');
  if (input.lines.length) {
    L.table(['Date', 'Officer', 'Hours', 'Rate', 'Amount'], [96, 200, 70, 70, 80],
      input.lines.map((l) => [ymdLabel(l.date), l.description && l.description !== 'Security officer services' ? `${l.guard} · ${l.description}` : l.guard, l.hours.toFixed(2), money(l.rate), money(l.hours * l.rate)]));
  } else L.paragraph('No billable hours in this period.', { color: GREY });
  L.ensure(70);
  L.y -= 6;
  const rightLine = (label: string, value: string, bold = false, size = 11) => {
    const font = bold ? f.bold : f.reg;
    L.page.drawText(label, { x: W - M - 240, y: L.y, size, font, color: bold ? INK : GREY });
    L.page.drawText(value, { x: W - M - font.widthOfTextAtSize(value, size), y: L.y, size, font, color: bold ? GOLD : INK });
    L.y -= size + 9;
  };
  rightLine('Total hours', hours.toFixed(2));
  rightLine('Amount due', money(total), true, 14);
  L.section('Payment');
  L.paragraph(input.payment.note || 'Pay by ACH — WaFd Bank', { font: f.bold, color: INK });
  if (input.payment.details) L.paragraph(input.payment.details);
  L.paragraph(`Terms: net ${input.payment.terms_days} days. Please include the invoice number ${inv.invoice_no} with your payment.`, { size: 9.5, color: GREY });
  if (inv.notes) { L.section('Notes'); L.paragraph(inv.notes); }
  L.footers(`${input.org.name} · Invoice ${inv.invoice_no} · Thank you for your business.`);
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
}
