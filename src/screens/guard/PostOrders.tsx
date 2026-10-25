import { Screen, TopBar, List, Row, SectionLabel, Empty } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { getRecord } from '../../data/repos/records';
import type { Site } from '../../data/types';
import { fmtDate } from '../../lib/format';
import { sanitizeHtml } from '../../lib/sanitize';
import { GuardRight } from './common';
import { BoloPinned } from './Bolo';

export function PostOrders({ siteId }: { siteId: string }) {
  const site = useData(() => getRecord<Site>('patrol_sites', siteId), [siteId]);
  const s = site.data;
  return (
    <Screen>
      <TopBar title={s?.name ?? 'Post orders'} backTo="/g" right={<GuardRight />} />
      <div class="screen-body">
        {s && (
          <>
            <BoloPinned siteId={s.id} />
            <div class="foot muted" style={{ padding: '4px 4px 10px' }}>{[s.address, s.city, s.state].filter(Boolean).join(', ')}{s.post_orders_updated_at ? ` · Updated ${fmtDate(s.post_orders_updated_at)}` : ''}</div>
            {s.post_orders_html ? <div class="card prose" data-testid="post-orders" dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.post_orders_html) }} /> : <Empty icon="file" title="No post orders yet" />}
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
          </>
        )}
      </div>
    </Screen>
  );
}
