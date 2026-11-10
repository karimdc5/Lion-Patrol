import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, Button, Field, Empty, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { onShift, logPatrolStart } from '../../data/guard';
import { prepareWithLimits } from '../../ui/Attachments';
import { getFix, type Fix } from '../../lib/geo';
import { navigate } from '../../router';
import type { Prepared } from '../../media/compress';

function toLocalInput(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Item 10: "Patrol start" from the + list — a short Log (DAR) entry, never an incident. */
export function PatrolStartForm() {
  const te = onShift.value;
  const [title, setTitle] = useState('Patrol started');
  const [notes, setNotes] = useState('');
  const [at, setAt] = useState(() => new Date().toISOString());
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(true);
  const [photos, setPhotos] = useState<Prepared[]>([]);
  const [busy, setBusy] = useState(false);
  const locate = async () => { setLocating(true); setFix(await getFix(8000)); setLocating(false); };
  useEffect(() => { void locate(); }, []);

  if (!te) {
    return (
      <Screen>
        <TopBar title="Patrol start" backTo="/g/report" />
        <div class="screen-body"><Empty icon="shield" title="Not clocked in" body="Clock in first, then start your patrol." action={<Button variant="primary" onClick={() => navigate('/g/clock')}>Clock in</Button>} /></div>
      </Screen>
    );
  }

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logPatrolStart({ title, notes, occurredAt: at, fix }, photos);
      toast('Patrol started · logged');
      navigate('/g/patrol', { replace: true });
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <TopBar title="Patrol start" backTo="/g/report" sub="Saved to your daily log" />
      <div class="screen-body stack-lg" style={{ paddingBottom: 120 }} data-testid="patrol-start-form">
        <div class="form-section">
          <Field label="Title"><input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} data-testid="ps-title" /></Field>
          <Field label="Notes (optional)">
            <textarea class="input" rows={3} value={notes} placeholder="e.g. Starting exterior round, east lot first." onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} data-testid="ps-notes" />
          </Field>
          <Field label="Time">
            <input class="input" type="datetime-local" value={toLocalInput(at)} onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) setAt(new Date(v).toISOString()); }} data-testid="ps-time" />
          </Field>
          <Field label="GPS">
            <div class="row">
              <span class="grow foot muted" data-testid="ps-gps">{locating ? 'Getting location…' : fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} (±${Math.round(fix.accuracy)} m)` : 'Location unavailable'}</span>
              <Button icon="pin" onClick={() => void locate()} aria-label="Refresh location">GPS</Button>
            </div>
          </Field>
        </div>
        <div class="form-section">
          <div class="cap">Photos</div>
          {photos.length > 0 && <div class="foot muted" data-testid="ps-photo-count">{photos.length} photo{photos.length > 1 ? 's' : ''} attached</div>}
          <label class="btn btn-outline" style={{ position: 'relative', overflow: 'hidden', alignSelf: 'flex-start' }}><Icon name="camera" /> Add photo
            <input type="file" accept="image/*" capture="environment" style={{ position: 'absolute', inset: 0, opacity: 0 }} data-testid="ps-photo"
              onChange={async (e) => { const f = (e.target as HTMLInputElement).files; if (f?.length) { try { const p = await prepareWithLimits(f[0]!); setPhotos((s) => [...s, p]); } catch (er) { toast((er as Error).message, 'error'); } } (e.target as HTMLInputElement).value = ''; }} />
          </label>
        </div>
      </div>
      <div class="sticky-bar">
        <Button variant="primary" size="lg" block loading={busy} onClick={() => void save()} data-testid="ps-save">Start patrol</Button>
      </div>
    </Screen>
  );
}
