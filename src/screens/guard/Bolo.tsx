import { useRef, useState } from 'preact/hooks';
import { Screen, TopBar, Button, Field, Toggle, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { activeBolos, createBolo } from '../../data/guard';
import { prepareWithLimits, AttachmentTray } from '../../ui/Attachments';
import { BoloCard } from '../../ui/BoloCard';
import { navigate } from '../../router';
import { GuardRight } from './common';
import type { Prepared } from '../../media/compress';

/** Active BOLOs for a site, pinned at the top of Home and Post orders. */
export function BoloPinned({ siteId, canCreate = false }: { siteId: string | null | undefined; canCreate?: boolean }) {
  const list = useData(() => activeBolos(siteId), [siteId]);
  if (!siteId || (!canCreate && !(list.data ?? []).length)) return null;
  return (
    <div class="stack" data-testid="bolo-pinned">
      {(list.data ?? []).map((b) => <BoloCard key={b.id} b={b}><AttachmentTray parentType="bolo" parentId={b.id} editable={false} label="Photos" /></BoloCard>)}
      {canCreate && <Button variant="outline" icon="eye" onClick={() => navigate(`/g/bolo/new/${siteId}`)} data-testid="bolo-new">New BOLO</Button>}
    </div>
  );
}

export function BoloCreate({ siteId }: { siteId: string }) {
  const [f, setF] = useState({ title: '', description: '', person_desc: '', vehicle_desc: '', expires: '', visible_to_client: false });
  const [staged, setStaged] = useState<Prepared[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const up = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setErr(null); };
  const save = async () => {
    if (lock.current) return;
    if (!f.title.trim()) return setErr('Give the BOLO a short title.');
    if (f.description.trim().length < 5) return setErr('Describe who or what to look out for.');
    if (!staged.length) return setErr('Add at least one photo.');
    lock.current = true; setBusy(true);
    try {
      await createBolo({ site_id: siteId, title: f.title, description: f.description, person_desc: f.person_desc, vehicle_desc: f.vehicle_desc, expires_at: f.expires ? new Date(f.expires).toISOString() : null, visible_to_client: f.visible_to_client }, staged);
      toast('BOLO posted for this site');
      navigate('/g', { replace: true });
    } catch (e) { toast((e as Error).message, 'error'); lock.current = false; } finally { setBusy(false); }
  };
  return (
    <Screen>
      <TopBar title="New BOLO" backTo="/g" right={<GuardRight />} />
      <div class="screen-body stack-lg" style={{ paddingBottom: 120 }}>
        <p class="foot muted">Be On the Lookout: pinned for everyone working this site until it’s resolved or expires.</p>
        <div class="form-section">
          <Field label="Title"><input class="input" value={f.title} placeholder="e.g. Repeat shoplifter, red hoodie" onInput={(e) => up({ title: (e.target as HTMLInputElement).value })} data-testid="bolo-title-input" /></Field>
          <Field label="Description"><textarea class="input" rows={3} value={f.description} placeholder="What happened, what to do if seen" onInput={(e) => up({ description: (e.target as HTMLTextAreaElement).value })} data-testid="bolo-desc" /></Field>
          <Field label="Person description (optional)"><input class="input" value={f.person_desc} placeholder="Age, height, clothing" onInput={(e) => up({ person_desc: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="Vehicle description (optional)"><input class="input" value={f.vehicle_desc} placeholder="Plate, make, color" onInput={(e) => up({ vehicle_desc: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="Expires (optional)"><input class="input" type="datetime-local" value={f.expires} onInput={(e) => up({ expires: (e.target as HTMLInputElement).value })} /></Field>
          <div class="row-between"><span>Show on client portal</span><Toggle label="Show on client portal" checked={f.visible_to_client} onChange={(v) => up({ visible_to_client: v })} /></div>
        </div>
        <div class="form-section">
          <div class="cap req">Photos</div>
          {staged.length > 0 && <div class="foot muted" data-testid="bolo-photo-count">{staged.length} photo{staged.length > 1 ? 's' : ''} attached</div>}
          <label class="btn btn-outline" style={{ position: 'relative', overflow: 'hidden' }}><Icon name="camera" /> Add photo
            <input type="file" accept="image/*" capture="environment" style={{ position: 'absolute', inset: 0, opacity: 0 }} data-testid="bolo-photo"
              onChange={async (e) => { const fl = (e.target as HTMLInputElement).files; if (fl?.length) { try { const p = await prepareWithLimits(fl[0]!); setStaged((s) => [...s, p]); setErr(null); } catch (er) { toast((er as Error).message, 'error'); } } (e.target as HTMLInputElement).value = ''; }} />
          </label>
        </div>
        {err && <div class="field-error" data-testid="bolo-error">{err}</div>}
      </div>
      <div class="sticky-bar"><Button variant="primary" size="lg" block loading={busy} onClick={() => void save()} data-testid="bolo-save">Post BOLO</Button></div>
    </Screen>
  );
}
