import { useEffect, useState } from 'preact/hooks';
import { Empty, Skeleton } from '../../ui/kit';
import { getBackend, phase } from '../../auth/session';
import type { Row } from '../../data/db';
import { PortalView, type ClientProof } from '../client/PortalView';

interface PortalData { org: Row; site: Row; incidents: Row[]; dars: Row[]; bolos?: Row[]; runs: Row[]; expires_at: string | null; proof?: ClientProof | null }

/** Read-only, no-login client portal for one site (opened from an admin-generated link). */
export default function PortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null | undefined>(undefined);
  const ready = phase.value !== 'booting';
  const load = () => getBackend().rpc<PortalData | null>('patrol_get_portal', { p_token: token }).then((d) => setData(d ?? null));
  useEffect(() => {
    if (!ready) return;
    void load().catch(() => setData(null));
  }, [ready, token]);
  // C1: the request lands as an owner task server-side; the thread is re-read from the server.
  const onRequest = async (body: string, name: string) => {
    await getBackend().rpc('patrol_portal_request', { p_token: token, p_body: body, p_name: name || null });
    await load().catch(() => undefined);
  };

  if (data === undefined) return <div class="portal"><div class="portal-inner stack"><Skeleton h={80} r={16} /><Skeleton h={160} r={16} /><Skeleton h={220} r={16} /></div></div>;
  if (data === null) return (
    <div class="portal"><div class="portal-inner">
      <PortalHeader orgName="Lion Security Services" />
      <Empty icon="lock" title="This link is no longer active" body="Ask Lion Security Services for a new client portal link." />
    </div></div>
  );
  const make = (kind: 'incident' | 'dar', id: string) => () => import('../../pdf/portal').then((m) => m.buildFromPortal(kind, data, id));
  return (
    <PortalView kind="portal" onRequest={onRequest} incidentPdf={(id) => make('incident', id)} darPdf={(id) => make('dar', id)}
      m={{ orgName: String(data.org.name), orgPhone: data.org.phone as string | null, orgEmail: data.org.email as string | null, siteName: String(data.site.name),
        siteAddress: [data.site.address, data.site.city, data.site.state].filter(Boolean).join(', '), incidents: data.incidents, dars: data.dars, runs: data.runs, bolos: data.bolos ?? [], expiresAt: data.expires_at, proof: data.proof ?? null }} />
  );
}

function PortalHeader({ orgName }: { orgName: string }) {
  return (
    <div class="row" style={{ gap: 12, paddingTop: 8 }}>
      <img src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`} alt="" style={{ width: 44 }} />
      <div><div class="brand-name" style={{ fontSize: 13 }}>{orgName.toUpperCase()}</div><div class="foot gold" style={{ fontWeight: 600, letterSpacing: '.06em' }}>CLIENT PORTAL · LICENSED & INSURED</div></div>
    </div>
  );
}
