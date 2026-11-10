import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, Button, Sheet, Empty, SkeletonList, toast, Field } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, isStaff, role } from '../../auth/session';
import { sitesFor, shiftsFor } from '../../data/repos/queries';
import { hasConsent, acceptConsent, clockIn, clockOut, onShift, openDar, reportGeofenceBlock } from '../../data/guard';
import { showPdf } from '../../ui/PdfReady';
import { hasAcked } from '../../data/postOrders';
import { listByParent } from '../../data/repos/records';
import { getFix, distanceM, geofenceCheck, type Fix } from '../../lib/geo';
import { navigate } from '../../router';
import { fmtTime, fmtHours } from '../../lib/format';

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
    setBlocked(null);
    try {
      // Item 18: guards can only clock in at the site (owners/supervisors are exempt).
      const here = await getFix(8000);
      const site = sites.data?.find((s) => s.id === selected);
      if (role.value === 'guard' && site) {
        const g = geofenceCheck(site, here);
        if (!g.ok) {
          setBlocked(g.distance == null
            ? 'Turn on location for Lion Patrol. You can only clock in when your phone shows you’re at the site.'
            : `You’re ${g.distance < 1000 ? `${Math.round(g.distance)} m` : `${(g.distance / 1609).toFixed(1)} mi`} from ${site.name}. Clock in when you’re at the site (within ${site.geofence_m} m).`);
          void reportGeofenceBlock(site.id, here);
          return;
        }
      }
      await clockIn(selected, myShift?.site_id === selected ? myShift.id : null, acceptedAt, here);
      toast('Clocked in. Stay safe.');
      // Item 24: first shift at this site → read and acknowledge the post orders first.
      navigate((await hasAcked(selected)) ? '/g' : `/g/post-orders/${selected}?first=1`, { replace: true });
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!(await hasConsent('gps_notice'))) { setNotice(true); return; }
    await doClockIn(new Date().toISOString());
  };
  const [blocked, setBlocked] = useState<string | null>(null);

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
        {blocked && <div class="form-error" role="alert" data-testid="geofence-blocked" style={{ marginBottom: 10 }}>{blocked}</div>}
        {blocked && <Button variant="ghost" block onClick={() => navigate('/g', { replace: true })} data-testid="clock-back-home" style={{ marginBottom: 8 }}>Back to Home</Button>}
        <Button variant="primary" size="lg" block disabled={!selected} loading={busy} onClick={() => void start()} data-testid="clock-in-btn">Clock in</Button>
      </div>
      <GpsNotice open={notice} onDecline={() => {
        // QA bug (b): explain instead of silently bouncing back. Consistent with the geofence design:
        // clocking in always records location (guards must be at the site), so it can't be skipped.
        setNotice(false);
        setBlocked('Location is required to clock in. Lion Patrol records it only while you’re on duty, so the owners can see you’re at your post. Tap Clock in and choose “Accept and continue”, or go back to Home.');
      }}
        onAccept={async () => { setNotice(false); const at = await acceptConsent('gps_notice'); await doClockIn(at); }} />
    </Screen>
  );
}

export function ClockOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [sheetNote, setSheetNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dar = useData(() => openDar(), [open]);
  const entries = useData(async () => (dar.data ? listByParent('patrol_dar_entries', dar.data.id) : []), [dar.data?.id]);
  const te = onShift.value;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!open) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, [open]);
  const minutes = te ? Math.max(0, Math.round((now - Date.parse(te.clock_in_at)) / 60000)) : 0;
  return (
    <Sheet open={open} onClose={onClose} title="Clock out" testid="clock-out-sheet"
      footer={<Button variant="primary" size="lg" block loading={busy} data-testid="clock-out-confirm" onClick={async () => {
        if (note.trim().length < 3) { setErr('Add a short shift note for the next guard and the owners.'); return; }
        if (!confirmed && !(wrong && sheetNote.trim().length >= 3)) { setErr('Confirm your hours, or tell the owner what’s wrong with them.'); return; }
        setBusy(true);
        try {
          const teId = await clockOut(note, note, { confirmed, note: wrong ? sheetNote : '' });
          toast('Clocked out. Daily report submitted.'); onClose(); setNote(''); setConfirmed(false); setWrong(false); setSheetNote('');
          navigate('/g', { replace: true });
          // Item 12: one end-of-shift PDF, saved to the shift for the owners, handed to the share sheet.
          if (teId) void import('../../pdf').then((m) => m.endOfShiftPdf(teId, { save: true })).then((r) => showPdf(r.bytes, r.filename, r.pages)).catch((e) => toast(`Shift PDF: ${(e as Error).message}`, 'error', 4000));
        }
        finally { setBusy(false); }
      }}>Clock out and submit DAR</Button>}>
      <div class="stack">
        <p class="muted sub">Your daily activity report ({entries.data?.length ?? 0} log entr{entries.data?.length === 1 ? 'y' : 'ies'}) will be submitted with this note. Location tracking stops now.</p>
        <Field label="Shift note" error={err}>
          <textarea class="input" rows={4} value={note} onInput={(e) => { setNote((e.target as HTMLTextAreaElement).value); setErr(null); }}
            placeholder="Quiet night. All doors secured at 05:40. Light out by the east lot." data-testid="shift-note" />
        </Field>
        {te && (
          <div class="card stack" data-testid="timesheet-confirm">
            <div class="row-between"><span class="headline">Timesheet</span><span class="pill pill-gold tnum" data-testid="timesheet-hours">{fmtHours(minutes)}</span></div>
            <div class="foot muted">{fmtTime(te.clock_in_at)} – now ({fmtTime(new Date(now).toISOString())})</div>
            <label class="row" style={{ gap: 10 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed((e.target as HTMLInputElement).checked); if ((e.target as HTMLInputElement).checked) setWrong(false); setErr(null); }} data-testid="timesheet-ok" style={{ width: 22, height: 22 }} />
              <span>I confirm these hours are correct</span>
            </label>
            <button class="link-btn" style={{ alignSelf: 'flex-start', minHeight: 0 }} onClick={() => { setWrong(!wrong); setConfirmed(false); }} data-testid="timesheet-wrong">Hours look wrong?</button>
            {wrong && <textarea class="input" rows={2} value={sheetNote} placeholder="e.g. Forgot to clock in, started at 9:00 PM." onInput={(e) => { setSheetNote((e.target as HTMLTextAreaElement).value); setErr(null); }} data-testid="timesheet-note" />}
          </div>
        )}
      </div>
    </Sheet>
  );
}
