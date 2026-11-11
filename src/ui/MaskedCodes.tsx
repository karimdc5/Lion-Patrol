import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Button } from './kit';
import { Icon } from './icons';
import { logAudit } from '../data/guard';

/**
 * Pass 9 A8: gate/door/alarm codes are hidden until tapped. Each reveal is logged (who, when, site)
 * in the owners' audit log, and the codes hide again after a minute. Only roles that can read
 * patrol_site_codes (staff + guards of the site; never clients) ever have the data on the device.
 * Codes never go into PDFs or the client portal.
 */
export function MaskedCodes({ siteId, children, label = 'Codes hidden', testid = 'codes-reveal', keepOpen = false }: { siteId: string; children: (shown: boolean) => ComponentChildren; label?: string; testid?: string; keepOpen?: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!shown || keepOpen) return; const t = setTimeout(() => setShown(false), 60_000); return () => clearTimeout(t); }, [shown, keepOpen]);
  if (!shown) {
    return (
      <div class="row-between" style={{ gap: 10 }}>
        <span class="row muted" style={{ gap: 8 }}><Icon name="lock" size={16} /><span class="tnum" aria-label={label}>•••• ••••</span><span class="foot">{label}</span></span>
        <Button variant="outline" onClick={() => { setShown(true); void logAudit('codes_viewed', { table: 'patrol_site_codes', id: siteId, siteId, detail: 'Codes revealed' }); }} data-testid={testid}>Tap to reveal (logged)</Button>
      </div>
    );
  }
  return (
    <>
      {children(true)}
      <div class="row-between foot muted"><span>Viewing is logged. Hides again in 1 minute.</span><button class="link-btn" style={{ minHeight: 0 }} onClick={() => setShown(false)} data-testid="codes-hide">Hide</button></div>
    </>
  );
}
