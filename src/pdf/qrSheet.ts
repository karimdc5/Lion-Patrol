import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { encode } from 'uqr';
import { safe, wrap } from './text';

export interface QrSheetInput {
  orgName: string;
  siteName: string;
  siteAddress: string;
  baseUrl: string; // e.g. https://karimdc5.github.io/Lion-Patrol/
  checkpoints: Array<{ name: string; code: string; seq: number; instructions?: string | null }>;
  logoPng?: Uint8Array | null;
}

// Dark theme (item 17). The QR itself stays black-on-white inside its frame so phones can scan it.
const BG = rgb(0.039, 0.059, 0.11);
const GOLD = rgb(0.83, 0.647, 0.215);
const INK = rgb(0.96, 0.97, 0.98);
const GREY = rgb(0.6, 0.64, 0.7);
const LIGHT = rgb(0.18, 0.22, 0.3);
const SOFT = rgb(0.08, 0.11, 0.18);

export const formatCode = (c: string) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
export const qrUrl = (base: string, code: string) => `${base.replace(/\/?$/, '/')}q/${code}`;

/** Draw a QR matrix as merged vector rectangles (crisp at any print size). */
function drawQr(page: PDFPage, data: boolean[][], x: number, y: number, size: number) {
  const n = data.length;
  const m = size / n;
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!data[row]![col]) { col++; continue; }
      let end = col;
      while (end + 1 < n && data[row]![end + 1]) end++;
      page.drawRectangle({ x: x + col * m, y: y + size - (row + 1) * m, width: (end - col + 1) * m + 0.05, height: m + 0.05, color: rgb(0, 0, 0) });
      col = end + 1;
    }
  }
}

function center(page: PDFPage, text: string, y: number, font: import('pdf-lib').PDFFont, size: number, color = INK) {
  const t = safe(text);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

/** One checkpoint per US-Letter page: big QR, name, manual code, instructions, letterhead. */
export async function buildQrSheet(input: QrSheetInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Checkpoint QR codes - ${input.siteName}`);
  doc.setAuthor(input.orgName);
  doc.setCreator('Lion Patrol');
  doc.setProducer('Lion Patrol');
  doc.setCreationDate(new Date());
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const logo = input.logoPng ? await doc.embedPng(input.logoPng) : null;
  const total = input.checkpoints.length;

  input.checkpoints.forEach((cp, i) => {
    const page = doc.addPage([612, 792]);
    const W = 612, M = 54;
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: BG });
    // letterhead
    let tx = M;
    if (logo) {
      const h = 46, w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M, y: 792 - M - h + 6, width: w, height: h });
      tx = M + w + 12;
    }
    page.drawText(safe(input.orgName.toUpperCase()), { x: tx, y: 792 - M - 14, size: 14, font: bold, color: INK });
    page.drawText('Lion Patrol  -  Patrol checkpoint', { x: tx, y: 792 - M - 31, size: 10, font: helv, color: GOLD });
    const right = `Checkpoint ${cp.seq} of ${total}`;
    page.drawText(right, { x: W - M - helv.widthOfTextAtSize(right, 10), y: 792 - M - 14, size: 10, font: helv, color: GREY });
    page.drawLine({ start: { x: M, y: 792 - M - 48 }, end: { x: W - M, y: 792 - M - 48 }, thickness: 1.5, color: GOLD });

    // title block
    let nameSize = 30;
    while (bold.widthOfTextAtSize(safe(cp.name), nameSize) > W - 2 * M && nameSize > 16) nameSize -= 1;
    center(page, cp.name, 640, bold, nameSize);
    center(page, input.siteName, 614, helv, 14, GREY);

    // QR with a thin gold frame
    const size = 300, qx = (W - size) / 2, qy = 288;
    const { data } = encode(qrUrl(input.baseUrl, cp.code), { ecc: 'Q', border: 2 });
    page.drawRectangle({ x: qx - 10, y: qy - 10, width: size + 20, height: size + 20, borderColor: GOLD, borderWidth: 2, color: rgb(1, 1, 1) });
    drawQr(page, data, qx, qy, size);

    // manual code
    center(page, "Can't scan? Enter this code in the app:", 250, helv, 11, GREY);
    center(page, formatCode(cp.code), 218, mono, 28);

    // instructions box
    const boxY = 102, boxH = 92;
    page.drawRectangle({ x: M, y: boxY, width: W - 2 * M, height: boxH, color: SOFT, borderColor: LIGHT, borderWidth: 1 });
    page.drawText('HOW TO LOG THIS CHECKPOINT', { x: M + 14, y: boxY + boxH - 20, size: 8.5, font: bold, color: GOLD });
    const lines = [
      '1. Open Lion Patrol on your phone and make sure you are clocked in.',
      '2. Tap Patrol > Scan checkpoint and point the camera at the code above.',
      ...(cp.instructions ? wrap(`Note: ${cp.instructions}`, helv, 10, W - 2 * M - 28) : []),
    ].slice(0, 4);
    lines.forEach((l, j) => page.drawText(safe(l), { x: M + 14, y: boxY + boxH - 38 - j * 14, size: 10, font: helv, color: INK }));

    // footer
    page.drawLine({ start: { x: M, y: 62 }, end: { x: W - M, y: 62 }, thickness: 0.5, color: LIGHT });
    page.drawText(safe(`${input.orgName}  -  ${input.siteName}${input.siteAddress ? `, ${input.siteAddress}` : ''}  -  Please do not remove`), { x: M, y: 46, size: 8, font: helv, color: GREY });
    const pn = `Page ${i + 1} of ${total}`;
    page.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 8), y: 46, size: 8, font: helv, color: GREY });
  });
  return doc.save();
}
