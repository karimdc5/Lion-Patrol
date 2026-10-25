import type { ComponentChildren } from 'preact';
import { fmtDateTime } from '../lib/format';

export interface BoloView { id: string; title: string; description: string; person_desc: string | null; vehicle_desc: string | null; expires_at: string | null }

/** One BOLO, used by guard Home / Post orders, admin Sites and the client portal. Photos come in as children. */
export function BoloCard({ b, children }: { b: BoloView; children?: ComponentChildren }) {
  return (
    <div class="card stack" style={{ borderLeft: '4px solid var(--danger)' }} data-testid="bolo-card">
      <div class="row-between"><span class="pill pill-danger">BOLO</span>{b.expires_at && <span class="foot muted">Until {fmtDateTime(b.expires_at)}</span>}</div>
      <b class="headline" data-testid="bolo-title">{b.title}</b>
      {b.description && <div class="foot">{b.description}</div>}
      {b.person_desc && <div class="foot"><b>Person:</b> {b.person_desc}</div>}
      {b.vehicle_desc && <div class="foot"><b>Vehicle:</b> {b.vehicle_desc}</div>}
      {children}
    </div>
  );
}
