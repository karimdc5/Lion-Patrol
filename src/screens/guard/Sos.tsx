import { useEffect, useState } from 'preact/hooks';
import { Sheet, Button } from '../../ui/kit';
import { HoldButton } from '../../ui/Hold';
import { Icon } from '../../ui/icons';
import { triggerSos, cancelSos, opState } from '../../data/guard';
import { getRecord } from '../../data/repos/records';
import { navigate, query } from '../../router';
import { signal } from '@preact/signals';
import { fmtTime } from '../../lib/format';
import { net } from '../../data/sync/status';
import type { Site } from '../../data/types';

export const sosSheetOpen = signal(false);

export async function fireSos() {
  sosSheetOpen.value = false;
  const id = await triggerSos();
  navigate(`/g/sos?id=${id}`);
}

/** Compact red SOS chip for every guard top bar; opens the hold-to-send sheet. */
export function SosChip() {
  return (
    <button class="sos-chip" onClick={() => { sosSheetOpen.value = true; }} aria-label="Emergency SOS" data-testid="sos-chip">SOS</button>
  );
}

export function SosSheet() {
  return (
    <Sheet open={sosSheetOpen.value} onClose={() => { sosSheetOpen.value = false; }} title="Emergency alert" testid="sos-sheet">
      <div class="stack-lg" style={{ alignItems: 'center', paddingBottom: 12 }}>
        <p class="muted sub" style={{ textAlign: 'center' }}>Press and hold for 2 seconds to alert the owners (with your GPS location if your phone has one).</p>
        <HoldButton label="Hold to send SOS" onConfirm={() => void fireSos()} class="hold-sos" testid="sos-hold" size={150}>
          <b style={{ fontSize: 30, letterSpacing: '.06em' }}>SOS</b><small>Hold 2s</small>
        </HoldButton>
        <a class="btn btn-outline btn-block btn-lg" href="tel:911"><Icon name="phone" /> Call 911</a>
      </div>
    </Sheet>
  );
}

export function SosScreen() {
  const id = query.value.get('id') ?? '';
  const [state, setState] = useState<'pending' | 'done' | 'dead'>('pending');
  const [alert, setAlert] = useState<Record<string, unknown> | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  // A5: one tap is enough — remember "safe" locally so a server refresh that hasn't seen the
  // cancel yet can't flip the screen back and make the guard tap again.
  const [safe, setSafe] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      setState(await opState('patrol_alerts', id));
      const a = (await getRecord<Record<string, unknown>>('patrol_alerts', id)) ?? null;
      setAlert(a);
      if (a?.site_id) setSite((await getRecord<Site>('patrol_sites', String(a.site_id))) ?? null);
      setTimeout(poll, 1000);
    };
    void poll();
    return () => { alive = false; };
  }, [id]);
  const cancelled = safe || alert?.status === 'cancelled';
  const hasFix = alert?.lat != null && alert?.lng != null;
  const siteText = site ? `${site.name}${site.address ? `, ${[site.address, site.city].filter(Boolean).join(', ')}` : ''}` : null;
  // A5: never claim a location was delivered when there wasn't one.
  const delivered = hasFix
    ? 'Your alert and GPS location were delivered. Stay where it’s safe.'
    : `Your alert was delivered — location unavailable${siteText ? `, last known site: ${siteText}` : ' (not clocked in at a site)'}. Call 911 if you’re in danger.`;
  return (
    <div class="sos-screen" data-testid="sos-screen">
      <div class="sos-pulse"><Icon name="alert" size={56} /></div>
      <h1 class="large-title" style={{ textAlign: 'center' }}>{cancelled ? 'Marked safe' : state === 'done' ? 'Owners notified' : 'Sending alert…'}</h1>
      <p class="sub" style={{ textAlign: 'center', opacity: 0.9, maxWidth: 320 }} data-testid="sos-status">
        {cancelled ? 'The owners will see you marked yourself safe.'
          : state === 'done' ? delivered
          : !net.value.online ? 'You’re offline. The alert will send the moment you have signal. Call 911 if you’re in danger.'
          : 'Delivering your alert…'}
      </p>
      <div class="sos-meta">
        <div><span>Time</span><b class="tnum">{alert ? fmtTime(alert.triggered_at as string) : '—'}</b></div>
        <div><span>Location</span><b class="tnum" data-testid="sos-location">{hasFix ? `${(alert!.lat as number).toFixed(5)}, ${(alert!.lng as number).toFixed(5)}` : siteText ? `GPS unavailable · site address: ${siteText}` : 'GPS unavailable'}</b></div>
      </div>
      <a class="btn btn-lg btn-block sos-911" href="tel:911"><Icon name="phone" /> Call 911</a>
      {!cancelled && <Button size="lg" block class="sos-safe" onClick={() => { setSafe(true); void cancelSos(id); }} data-testid="sos-safe">I’m safe — cancel alert</Button>}
      <button class="link-btn" style={{ color: '#fff', alignSelf: 'center' }} onClick={() => navigate('/g')} data-testid="sos-back">Back to app</button>
    </div>
  );
}
