import { useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, Empty, Button, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { getRecord } from '../../data/repos/records';
import type { Site } from '../../data/types';
import { fmtDate } from '../../lib/format';
import { sanitizeHtml } from '../../lib/sanitize';
import { GuardRight } from './common';
import { BoloPinned } from './Bolo';
import { siteCodes, hasAcked, acknowledgePostOrders } from '../../data/postOrders';
import { navigate, query } from '../../router';

/** Post orders for a site: rules, codes (guards only), contacts. Acknowledged once, on the first shift there (item 24). */
export function PostOrders({ siteId }: { siteId: string }) {
  const site = useData(() => getRecord<Site>('patrol_sites', siteId), [siteId]);
  const codes = useData(() => siteCodes(siteId), [siteId]);
  const acked = useData(() => hasAcked(siteId), [siteId]);
  const [busy, setBusy] = useState(false);
  const first = query.value.get('first') === '1';
  const s = site.data;
  const needAck = acked.data === false;
  return (
    <Screen>
      <TopBar title={s?.name ?? 'Post orders'} backTo={needAck ? undefined : '/g'} right={<GuardRight />} />
      <div class="screen-body" style={{ paddingBottom: needAck ? 120 : undefined }}>
        {s && (
          <>
            {needAck && (
              <div class="card row" style={{ borderColor: 'var(--gold)', marginBottom: 12 }} data-testid="po-first-shift">
                <span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="file" /></span>
                <span class="sub"><b>{first ? 'First shift at this site.' : 'Not acknowledged yet.'}</b> Read the post orders below, then tap “I’ve read the post orders”.</span>
              </div>
            )}
            <BoloPinned siteId={s.id} />
            <div class="foot muted" style={{ padding: '4px 4px 10px' }}>{[s.address, s.city, s.state].filter(Boolean).join(', ')}{s.post_orders_updated_at ? ` · Updated ${fmtDate(s.post_orders_updated_at)}` : ''}</div>
            {s.post_orders_html ? <div class="card prose" data-testid="post-orders" dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.post_orders_html) }} /> : <Empty icon="file" title="No post orders yet" />}
            {(codes.data?.codes || codes.data?.guard_notes) && (
              <>
                <SectionLabel>Codes & guard notes</SectionLabel>
                <div class="card stack" data-testid="po-codes">
                  {codes.data!.codes && <pre class="po-codes">{codes.data!.codes}</pre>}
                  {codes.data!.guard_notes && <div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{codes.data!.guard_notes}</div>}
                  <div class="foot faint">Guards only. Never share codes with anyone off the team.</div>
                </div>
              </>
            )}
            {s.contacts?.length > 0 && (
              <>
                <SectionLabel>Contacts</SectionLabel>
                <List>
                  {s.contacts.map((c, i) => (
                    <Row key={i} icon="phone" title={c.name} sub={[c.role, c.phone].filter(Boolean).join(' · ')}
                      right={c.phone ? <a class="btn btn-outline" style={{ height: 36 }} href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>Call</a> : undefined} />
                  ))}
                </List>
              </>
            )}
            {acked.data && <p class="foot faint" style={{ textAlign: 'center', marginTop: 16 }} data-testid="po-acked">You’ve acknowledged these post orders.</p>}
          </>
        )}
      </div>
      {needAck && s && (
        <div class="sticky-bar">
          <Button variant="primary" size="lg" block loading={busy} data-testid="po-ack" onClick={async () => {
            setBusy(true);
            try { await acknowledgePostOrders(s.id, s.post_orders_updated_at); toast('Post orders acknowledged'); navigate('/g', { replace: true }); }
            catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
          }}>I’ve read the post orders</Button>
        </div>
      )}
    </Screen>
  );
}
