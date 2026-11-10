import { useState } from 'preact/hooks';
import { Button, toast } from './kit';
import { showPdf } from './PdfReady';

/** Generates a PDF on tap, then shows the share/download sheet (iOS needs a second tap to share). */
export function PdfButton({ make, label = 'PDF', testid, block, variant = 'default' }: { make: () => Promise<{ bytes: Uint8Array; pages: number; filename: string }>; label?: string; testid?: string; block?: boolean; variant?: 'default' | 'primary' | 'outline' }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button icon="download" variant={variant} block={block} loading={busy} data-testid={testid} onClick={async () => {
      setBusy(true);
      try { const r = await make(); showPdf(r.bytes, r.filename, r.pages); }
      catch (e) { toast(`Couldn’t create the PDF: ${(e as Error).message}`, 'error', 4000); }
      finally { setBusy(false); }
    }}>{label}</Button>
  );
}
