import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet, Button, Field, haptic, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { scanCheckpoint, onShift, addDarEntry, type ScanResult } from '../../data/guard';
import { navigate, query } from '../../router';
import { AttachmentTray } from '../../ui/Attachments';
import { FlagPills } from './Patrol';

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

export function ScanScreen() {
  const video = useRef<HTMLVideoElement>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const busy = useRef(false);
  const showing = useRef(false); // result sheet open → ignore further frames
  const streamRef = useRef<MediaStream | null>(null);

  const submit = async (raw: string, method: 'qr' | 'manual') => {
    if (busy.current || showing.current) return;
    busy.current = true;
    try {
      const r = await scanCheckpoint(raw, method);
      haptic('success');
      showing.current = true;
      setResult(r); setManual(false); setCode(''); setErr(null);
    } catch (e) {
      haptic('warning');
      if (method === 'manual') setErr((e as Error).message); else toast((e as Error).message, 'error', 3500);
      setTimeout(() => { busy.current = false; }, method === 'qr' ? 1800 : 0);
      return;
    }
    busy.current = false;
  };

  useEffect(() => {
    if (!onShift.value) { toast('Clock in before scanning checkpoints.', 'info'); navigate('/g/clock', { replace: true }); return; }
    const preset = query.value.get('code');
    if (preset) void submit(preset, 'qr');
  }, []);

  useEffect(() => {
    let stopped = false, timer = 0;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamErr('Camera not available. Enter the code instead.'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        let detector: Detector | null = null;
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) { try { detector = new BD({ formats: ['qr_code'] }); } catch { detector = null; } }
        const jsQR = detector ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const loop = async () => {
          if (stopped) return;
          if (v.readyState >= 2 && !busy.current && !showing.current) {
            try {
              let value: string | null = null;
              if (detector) value = (await detector.detect(v))[0]?.rawValue ?? null;
              else if (jsQR && v.videoWidth) {
                const scale = Math.min(1, 640 / v.videoWidth);
                canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                value = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
              }
              if (value) await submit(value, 'qr');
            } catch { /* keep scanning */ }
          }
          timer = window.setTimeout(() => void loop(), 160);
        };
        void loop();
      } catch (e) {
        setCamErr((e as Error).name === 'NotAllowedError' ? 'Camera access is off. Allow it in Settings, or enter the code printed under the QR.' : 'Couldn’t start the camera. Enter the code instead.');
      }
    })();
    return () => { stopped = true; clearTimeout(timer); streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { /* unsupported */ }
  };

  const finish = async (next: boolean) => {
    if (note.trim() && result) { try { await addDarEntry(`Checkpoint ${result.checkpoint.name}: ${note.trim()}`, null); } catch { /* not on shift */ } }
    setNote('');
    setResult(null);
    showing.current = false;
    if (!next) navigate('/g/patrol');
  };

  return (
    <div class="scanner" data-testid="scanner">
      <video ref={video} playsInline muted autoPlay />
      <div class="scan-mask"><div class="scan-window"><span class="scan-corner tl" /><span class="scan-corner tr" /><span class="scan-corner bl" /><span class="scan-corner br" /></div></div>
      <div class="scan-top">
        <button class="icon-btn" aria-label="Close scanner" onClick={() => navigate('/g/patrol')}><Icon name="x" /></button>
        {torch !== null && <button class="icon-btn" aria-label="Toggle flashlight" onClick={() => void toggleTorch()} style={torch ? { color: 'var(--gold)' } : undefined}><Icon name="flame" /></button>}
      </div>
      <div class="scan-bottom">
        <div class="scan-hint">{camErr ?? 'Point the camera at the checkpoint QR code'}</div>
        <Button variant={camErr ? 'primary' : 'outline'} size="lg" style={{ minWidth: 240, background: camErr ? undefined : 'rgba(0,0,0,.45)', color: '#fff' }} onClick={() => setManual(true)} data-testid="manual-entry">Enter code manually</Button>
      </div>

      <Sheet open={manual} onClose={() => setManual(false)} title="Enter checkpoint code" testid="manual-sheet"
        footer={<Button variant="primary" size="lg" block onClick={() => void submit(code, 'manual')} disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 4} data-testid="manual-submit">Log checkpoint</Button>}>
        <Field label="Code printed under the QR" error={err}>
          <input class="input input-code" value={code} autoCapitalize="characters" spellcheck={false} autoComplete="off" placeholder="7K4Q-9XW2" data-testid="manual-code"
            onInput={(e) => { setCode((e.target as HTMLInputElement).value.toUpperCase()); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(code, 'manual'); }} />
        </Field>
      </Sheet>

      <Sheet open={!!result} onClose={() => void finish(true)} testid="scan-result">
        {result && (
          <div class="stack" style={{ textAlign: 'center' }}>
            <div class="scan-burst"><Icon name="check" size={48} strokeWidth={3} /></div>
            <div class="title" data-testid="scan-result-name">{result.checkpoint.name}</div>
            <div class="muted sub tnum">{result.done} of {result.total} checkpoints · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            {result.flags.length > 0 && <div class="chip-row" style={{ justifyContent: 'center' }}><FlagPills flags={result.flags} /></div>}
            <div style={{ textAlign: 'left' }} class="stack">
              <Field label="Note (optional)"><input class="input" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} placeholder="Door secure, lights on" /></Field>
              <AttachmentTray parentType="scan" parentId={result.scanId} label="Checkpoint photos" />
            </div>
            <div class="grid-2">
              <Button size="lg" onClick={() => void finish(false)} data-testid="scan-done">Done</Button>
              <Button variant="primary" size="lg" onClick={() => void finish(true)} data-testid="scan-next">Scan next</Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
