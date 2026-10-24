import type { PDFFont } from 'pdf-lib';

/** Map characters outside WinAnsi (standard PDF fonts) to safe equivalents. */
export function safe(s: string): string {
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[→➔➡]/g, '>').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•€]/g, '?');
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) { line = next; continue; }
      if (line) out.push(line);
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        out.push(w.slice(0, cut)); w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}
