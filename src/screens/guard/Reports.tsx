import { Screen, TopBar, Empty, SectionLabel } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { getRecord, listRecords } from '../../data/repos/records';
import { PdfButton } from '../../ui/PdfButton';
import { fmtDateTime, fmtDate } from '../../lib/format';
import { GuardRight } from './common';
import type { Row as R } from '../../data/db';

/** Guard's read-only view of their own submitted incident, with the PDF. */
export function GuardIncidentView({ id }: { id: string }) {
  const i = useData(() => getRecord<R>('patrol_incidents', id), [id]);
  const x = i.data;
  return (
    <Screen>
      <TopBar title={String(x?.report_no ?? 'Report')} backTo="/g/activity" right={<GuardRight />} />
      <div class="screen-body stack-lg">
        {!x ? <Empty icon="file" title="Report not found" /> : (
          <>
            <div><h1 class="title">{String(x.title || x.category_name)}</h1><div class="muted sub">{String(x.category_name ?? '')}{x.subtype_name ? ` › ${x.subtype_name}` : ''} · {fmtDateTime(x.occurred_at as string)}</div></div>
            <div><SectionLabel>Narrative</SectionLabel><div class="card" style={{ whiteSpace: 'pre-wrap', lineHeight: '24px' }}>{String(x.description)}</div></div>
            <PdfButton block variant="primary" label="Download PDF report" testid="guard-incident-pdf" make={() => import('../../pdf').then((m) => m.incidentPdf(id, { includeInternal: false }))} />
          </>
        )}
      </div>
    </Screen>
  );
}

/** Guard's own daily report for a shift (by time entry). */
export function GuardDarView({ timeEntryId }: { timeEntryId: string }) {
  const dar = useData(async () => (await listRecords<R>('patrol_dars')).find((d) => d.time_entry_id === timeEntryId), [timeEntryId]);
  const d = dar.data;
  return (
    <Screen>
      <TopBar title="Daily report" backTo="/g/activity" right={<GuardRight />} />
      <div class="screen-body stack-lg">
        {!d ? <Empty icon="activity" title="Daily report not found" /> : (
          <>
            <div><h1 class="title">Daily activity · {fmtDate(`${d.report_date}T12:00:00Z`)}</h1><div class="muted sub">{String(d.report_no ?? 'Not numbered yet')} · {String(d.status).replace(/_/g, ' ')}</div></div>
            {d.summary ? <div class="card">{String(d.summary)}</div> : null}
            <PdfButton block variant="primary" label="Download PDF report" testid="guard-dar-pdf" make={() => import('../../pdf').then((m) => m.darPdf(d.id))} />
          </>
        )}
      </div>
    </Screen>
  );
}
