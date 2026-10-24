import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, Button, Sheet, Empty, SkeletonList, toast, Field } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, isStaff } from '../../auth/session';
import { sitesFor, shiftsFor } from '../../data/repos/queries';
import { hasConsent, acceptConsent, clockIn, clockOut, onShift, openDar } from '../../data/guard';
import { listByParent } from '../../data/repos/records';
import { getFix, distanceM, type Fix } from '../../lib/geo';
import { navigate } from '../../router';
import { fmtTime } from '../../lib/format';

export function GpsNotice({ open, onAccept, onDecline }: { open: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <Sheet open={open} onClose={onDecline} title="Location while on duty" testid="gps-notice"
      footer={<>
        <Button variant="primary" size="lg" block onClick={onAccept} data-testid="gps-accept">Accept and continue</Button>
        <Button variant="ghost" block onClick={onDecline} data-testid="gps-decline">Not now</Button>
      </>}>
      <div class="stack">
        <div class="row" style={{ alignItems: 'flex-start' }}><span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="pin" /></span>
          <p class="sub">Lion Patrol records your location <b>only while you’re clocked in</b>: at clock-in and clock-out, at each checkpoint scan, and periodically while the app is open, to verify patrols and for your safety.</p></div>
        <div class="row" style={{ alignItems: 'flex-start' }}><span class="list-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><Icon name="clock" /></span>
          <p class="sub">Tracking <b>stops when you clock out</b>. Nothing is recorded off duty.</p></div>
        <div class="row" style={{ alignItems: 'flex-start' }}><span class="list-icon" style={{ background: 'var(--raised-2)' }}><Icon name="smartphone" /></span>
          <p class="sub muted">iPhone pauses web apps in the background, so location updates only while Lion Patrol is open on screen.</p></div>
      </div>
    </Sheet>
  );
}

export function ClockScreen() {
  const org = currentOrgId.value, me = memberId.value;
  const sites = useData(() => sitesFor(org, me, isStaff.value), [org, me]);
  const shifts = useData(() => shiftsFor(org), [org]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const myShift = (shifts.data ?? []).find((s) => s.member_id === me && Date.parse(s.starts_at) - 2 * 3600e3 < now && Date.parse(s.ends_at) > now);

  useEffect(() => { if (onShift.value) navigate('/g', { replace: true }); }, []);
  useEffect(() => {
    if (!selected && sites.data?.length) setSelected(myShift?.site_id ?? (sites.data.length === 1 ? sites.data[0]!.id : null));
  }, [sites.data, myShift?.site_id]);
  useEffect(() => { void hasConsent('gps_notice').then((ok) => { if (ok) void getFix(6000).then(setFix); }).catch(() => undefined); }, []);

  const doClockIn = async (acceptedAt: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await clockIn(selected, myShift?.site_id === selected ? myShift.id : null, acceptedAt);
      toast('Clocked in. Stay safe.');
      navigate('/g', { replace: true });
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!(await hasConsent('gps_notice'))) { setNotice(true); return; }
    await doClockIn(new Date().toISOString());
  };

  return (
    <Screen>
      <TopBar title="Clock in" backTo="/g" />
      <div class="screen-body stack" style={{ paddingBottom: 120 }}>
        <p class="muted sub" style={{ padding: '0 4px' }}>Choose your post for this shift.</p>
        {sites.loading ? <SkeletonList rows={2} /> : !sites.data?.length ? <Empty icon="building" title="No sites assigned" body="Ask your supervisor to assign you to a site." /> : (
          <div class="stack" data-testid="site-picker">
            {sites.data.map((s) => {
              const dist = fix && s.lat != null && s.lng != null ? distanceM(fix, { lat: s.lat, lng: s.lng }) : null;
              return (
                <button key={s.id} class={`site-card ${selected === s.id ? 'selected' : ''}`} onClick={() => setSelected(s.id)} data-testid="site-option" aria-pressed={selected === s.id}>
                  <span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)', width: 44, height: 44, borderRadius: 12 }}><Icon name={s.kind === 'apartment' ? 'building' : 'store'} /></span>
                  <span class="grow">
                    <span style={{ display: 'block', fontWeight: 600 }}>{s.name}</span>
                    <span class="foot muted">{[s.address, s.city].filter(Boolean).join(', ')}{dist != null ? ` · ${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1609).toFixed(1)} mi`} away` : ''}</span>
                    {myShift?.site_id === s.id && <span class="pill pill-gold" style={{ marginTop: 6 }}>Scheduled {fmtTime(myShift.starts_at)}–{fmtTime(myShift.ends_at)}</span>}
                  </span>
                  {selected === s.id && <Icon name="check-circle" class="gold" size={24} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div class="sticky-bar">
        <Button variant="primary" size="lg" block disabled={!selected} loading={busy} onClick={() => void start()} data-testid="clock-in-btn">Clock in</Button>
      </div>
      <GpsNotice open={notice} onDecline={() => { setNotice(false); toast('Location notice is required to clock in.', 'info'); }}
        onAccept={async () => { setNotice(false); const at = await acceptConsent('gps_notice'); await doClockIn(at); }} />
    </Screen>
  );
}

export function ClockOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dar = useData(() => openDar(), [open]);
  const entries = useData(async () => (dar.data ? listByParent('patrol_dar_entries', dar.data.id) : []), [dar.data?.id]);
  return (
    <Sheet open={open} onClose={onClose} title="Clock out" testid="clock-out-sheet"
      footer={<Button variant="primary" size="lg" block loading={busy} data-testid="clock-out-confirm" onClick={async () => {
        if (note.trim().length < 3) { setErr('Add a short shift note for the next guard and the owners.'); return; }
        setBusy(true);
        try { await clockOut(note, note); toast('Clocked out. Daily report submitted.'); onClose(); setNote(''); navigate('/g', { replace: true }); }
        finally { setBusy(false); }
      }}>Clock out and submit DAR</Button>}>
      <div class="stack">
        <p class="muted sub">Your daily activity report ({entries.data?.length ?? 0} log entr{entries.data?.length === 1 ? 'y' : 'ies'}) will be submitted with this note. Location tracking stops now.</p>
        <Field label="Shift note" error={err}>
          <textarea class="input" rows={4} value={note} onInput={(e) => { setNote((e.target as HTMLTextAreaElement).value); setErr(null); }}
            placeholder="Quiet night. All doors secured at 05:40. Light out by the east lot." data-testid="shift-note" />
        </Field>
      </div>
    </Sheet>
  );
}
