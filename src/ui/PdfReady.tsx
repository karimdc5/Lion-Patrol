import { signal } from '@preact/signals';
import { Sheet, Button, toast } from './kit';
import { Icon } from './icons';
import { fmtBytes } from '../lib/format';

interface Ready { file: File; pages: number }
export const pdfReady = signal<Ready | null>(null);

/** Two-step delivery: iOS needs a fresh tap for navigator.share, so we present the finished PDF here. */
export function showPdf(bytes: Uint8Array, filename: string, pages: number) {
  const file = new File([bytes as BlobPart], filename, { type: 'application/pdf' });
  if (__E2E__) (window as unknown as { __lpLastPdf?: { name: string; bytes: number[] } }).__lpLastPdf = { name: filename, bytes: Array.from(bytes) };
  pdfReady.value = { file, pages };
}

export function PdfReadySheet() {
  const r = pdfReady.value;
  const close = () => { pdfReady.value = null; };
  const canShare = !!r && typeof navigator.canShare === 'function' && navigator.canShare({ files: [r.file] });
  const url = r ? URL.createObjectURL(r.file) : '';
  return (
    <Sheet open={!!r} onClose={close} title="PDF ready" testid="pdf-ready">
      {r && (
        <div class="stack">
          <div class="card row">
            <span class="list-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', width: 44, height: 44, borderRadius: 12 }}><Icon name="file" /></span>
            <div class="grow" style={{ minWidth: 0 }}>
              <div class="ellipsis" style={{ fontWeight: 600 }}>{r.file.name}</div>
              <div class="foot muted">{r.pages} page{r.pages === 1 ? '' : 's'} · {fmtBytes(r.file.size)}</div>
            </div>
          </div>
          {canShare && (
            <Button variant="primary" size="lg" block icon="share" data-testid="pdf-share" onClick={async () => {
              try { await navigator.share({ files: [r.file], title: r.file.name }); } catch (e) { if ((e as Error).name !== 'AbortError') toast('Sharing failed. Use Download instead.', 'error'); }
            }}>Share or print</Button>
          )}
          <a class={`btn btn-block btn-lg ${canShare ? '' : 'btn-primary'}`} href={url} download={r.file.name} data-testid="pdf-download"><Icon name="download" /> Download</a>
          <a class="btn btn-block btn-ghost" href={url} target="_blank" rel="noopener">Open in viewer</a>
        </div>
      )}
    </Sheet>
  );
}
