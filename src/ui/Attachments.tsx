import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { Sheet, Button, toast } from './kit';
import { useData } from './useData';
import { db } from '../data/db';
import { listAttachments, addAttachment, removeAttachment, hasConsent, acceptConsent, labelFor, type AttachmentRow, type ParentType } from '../data/guard';
import { prepareFile, MediaError, type Prepared } from '../media/compress';
import { publicSettings } from '../data/repos/queries';
import { currentOrgId } from '../auth/session';
import { syncState } from '../data/sync/status';

/** Object URL for a locally stored blob (full or thumb). */
function useBlobUrl(id: string, which: 'bytes' | 'thumb') {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void (async () => {
      const b = await (await db()).get('blobs', id);
      const buf = b ? (which === 'thumb' ? b.thumb ?? (b.mime.startsWith('image/') ? b.bytes : null) : b.bytes) : null;
      if (buf) { u = URL.createObjectURL(new Blob([buf], { type: which === 'thumb' ? 'image/jpeg' : b!.mime })); setUrl(u); }
    })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id, which]);
  return url;
}

export async function prepareWithLimits(file: File, voice = false, durationS?: number): Promise<Prepared> {
  const s = await publicSettings(currentOrgId.value);
  return prepareFile(file, { maxVideoMb: s?.max_video_mb ?? 50, maxVideoS: s?.max_video_s ?? 60, voice, durationS });
}

function Thumb({ a, onOpen, onRemove }: { a: AttachmentRow; onOpen: () => void; onRemove?: () => void }) {
  const thumb = useBlobUrl(a.id, 'thumb');
  const pending = a.upload_status !== 'uploaded' && (a as AttachmentRow & { _pending?: boolean })._pending !== false;
  const icon = a.kind === 'video' ? 'camera' : a.kind === 'document' ? 'file' : a.kind === 'image' ? 'camera' : 'mic';
  return (
    <div class="att" data-testid="attachment">
      <button style={{ position: 'absolute', inset: 0 }} aria-label={`Open ${labelFor(a.kind)}`} onClick={onOpen} />
      {thumb ? <img src={thumb} alt="" /> : <Icon name={icon} size={28} />}
      <span class="att-badge">
        <Icon name={pending ? (syncState.value === 'offline' ? 'clock' : 'cloud-up') : 'check'} />
        {a.kind === 'image' ? '' : labelFor(a.kind)}
      </span>
      {onRemove && <button class="att-x" aria-label="Remove attachment" onClick={onRemove}><Icon name="x" /></button>}
    </div>
  );
}

function Viewer({ a, onClose }: { a: AttachmentRow | null; onClose: () => void }) {
  const url = useBlobUrl(a?.id ?? '', 'bytes');
  return (
    <Sheet open={!!a} onClose={onClose} title={a ? labelFor(a.kind) : ''}>
      {a && !url && <p class="muted">This file is stored on the server. It opens from the dashboard.</p>}
      {a && url && (a.kind === 'image' ? <img class="media-view" src={url} alt="Attachment" />
        : a.kind === 'video' ? <video class="media-view" src={url} controls playsInline />
        : a.kind === 'document' ? <a class="btn btn-block" href={url} target="_blank" rel="noopener">Open PDF</a>
        : <audio src={url} controls style={{ width: '100%' }} />)}
    </Sheet>
  );
}

/** Horizontal attachment tray + add actions. `ensureParent` must make sure the parent row is queued and return its op id. */
export function AttachmentTray({ parentType, parentId, ensureParent, editable = true, label = 'Attachments' }: {
  parentType: ParentType; parentId: string; ensureParent?: () => Promise<string | null>; editable?: boolean; label?: string;
}) {
  const list = useData(() => listAttachments(parentId), [parentId]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<AttachmentRow | null>(null);
  const [recOpen, setRecOpen] = useState(false);
  const add = async (files: FileList | File[] | null, voice = false, durationS?: number) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const parentOp = ensureParent ? await ensureParent() : null;
      for (const f of Array.from(files)) {
        const p = await prepareWithLimits(f, voice, durationS);
        await addAttachment(parentType, parentId, p, parentOp);
      }
    } catch (e) {
      toast(e instanceof MediaError ? e.message : `Couldn’t add that file: ${(e as Error).message}`, 'error', 4000);
    } finally { setBusy(false); }
  };
  const items = list.data ?? [];
  return (
    <div class="stack" style={{ gap: 10 }}>
      {items.length > 0 && (
        <div class="att-tray" aria-label={label}>
          {items.map((a) => <Thumb key={a.id} a={a} onOpen={() => setOpen(a)} onRemove={editable ? () => void removeAttachment(a) : undefined} />)}
        </div>
      )}
      {editable && (
        <div class="att-actions">
          <label class="att-action"><Icon name="camera" />Camera
            <input type="file" accept="image/*" capture="environment" aria-label="Take photo" data-testid="att-camera" onChange={(e) => { void add((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
          </label>
          <label class="att-action"><Icon name="layers" />Library
            <input type="file" accept="image/*,video/*" multiple aria-label="Photo or video from library" data-testid="att-library" onChange={(e) => { void add((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
          </label>
          <button type="button" class="att-action" onClick={() => setRecOpen(true)} data-testid="att-voice"><Icon name="mic" />Voice</button>
          <label class="att-action"><Icon name="file" />File
            <input type="file" accept="audio/*,application/pdf" aria-label="Audio or PDF file" data-testid="att-file" onChange={(e) => { void add((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
          </label>
        </div>
      )}
      {busy && <div class="row foot muted"><span class="spinner" /> Preparing file…</div>}
      <Viewer a={open} onClose={() => setOpen(null)} />
      <Recorder open={recOpen} onClose={() => setRecOpen(false)} onDone={(f, d) => void add([f], true, d)} />
    </div>
  );
}

/** Explicit tap-to-record voice note of the guard's own account. No background/covert recording. */
function Recorder({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (f: File, durationS: number) => void }) {
  const [phase, setPhase] = useState<'notice' | 'idle' | 'recording' | 'error'>('idle');
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const MAX = 120;

  useEffect(() => {
    if (!open) return;
    void hasConsent('audio_notice').then((ok) => setPhase(ok ? 'idle' : 'notice')).catch(() => setPhase('notice'));
  }, [open]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSecs(s);
      if (s >= MAX) stop();
    }, 250);
    const onHide = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onHide); };
  }, [phase]);

  const release = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => (window.MediaRecorder as typeof MediaRecorder | undefined)?.isTypeSupported?.(m)) ?? '';
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        release();
        const type = r.mimeType || mime || 'audio/mp4';
        const blob = new Blob(chunks.current, { type });
        const dur = Math.round((Date.now() - started.current) / 1000);
        if (blob.size > 0) onDone(new File([blob], `voice-note.${type.includes('webm') ? 'webm' : 'm4a'}`, { type: type.split(';')[0] }), dur);
        setPhase('idle'); setSecs(0); onClose();
      };
      rec.current = r;
      started.current = Date.now();
      r.start(1000);
      setPhase('recording');
    } catch (e) {
      release();
      setErr((e as Error).name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in Settings → Safari (or the app) → Microphone.' : 'Recording isn’t available on this device.');
      setPhase('error');
    }
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
  const close = () => { if (phase === 'recording') stop(); else { release(); onClose(); } };

  return (
    <Sheet open={open} onClose={close} title={phase === 'notice' ? 'Before you record' : 'Voice note'} testid="recorder">
      {phase === 'notice' && (
        <div class="stack">
          <div class="banner banner-warning"><Icon name="info" /><div><b>Washington requires everyone’s consent to record a conversation.</b> Use voice notes only to dictate your own account of what happened. Never record other people without their consent. Recording only happens while you hold this screen open and tap record.</div></div>
          <Button variant="primary" size="lg" block data-testid="audio-consent" onClick={async () => { await acceptConsent('audio_notice'); setPhase('idle'); }}>I understand</Button>
        </div>
      )}
      {phase === 'idle' && (
        <div class="stack" style={{ alignItems: 'center' }}>
          <p class="muted sub" style={{ textAlign: 'center' }}>Describe what you saw in your own words. Up to 2 minutes.</p>
          <Button variant="danger" size="lg" block icon="mic" onClick={() => void start()}>Start recording</Button>
        </div>
      )}
      {phase === 'recording' && (
        <div class="stack" style={{ alignItems: 'center' }}>
          <div class="row" style={{ gap: 10 }}><span class="rec-dot" /><b class="title tnum">{String(Math.floor(secs / 60))}:{String(secs % 60).padStart(2, '0')}</b><span class="muted foot">/ 2:00</span></div>
          <p class="foot muted">Recording your voice note…</p>
          <Button size="lg" block icon="check" onClick={stop}>Stop and save</Button>
        </div>
      )}
      {phase === 'error' && <div class="form-error">{err}</div>}
    </Sheet>
  );
}
