import { Screen, TopBar, SyncPill, Empty } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { lazyScreen } from '../../ui/lazy';
import { currentOrgId, isAdmin } from '../../auth/session';
import { loadOps } from './ops';
import { siteCover, sitePhotoUrl } from '../../ui/SitePhoto';
import { relTime } from '../../lib/format';
import type { SitePin, GuardPin } from '../../ui/OwnerMapView';

const OwnerMapView = lazyScreen<{ sites: SitePin[]; guards: GuardPin[]; height?: number }>(() => import('../../ui/OwnerMapView'), () => <div class="map-box skel" style={{ height: 520 }} />);

/**
 * Item 20: owners-only map. Site pins (photo in the popup) and on-duty guards at their latest GPS
 * point — only while clocked in (patrol_member_status.on_duty); nothing is shown off shift.
 */
export function OwnerMap() {
  const org = currentOrgId.value;
  const d = useData(() => loadOps(org), [org]);
  if (!isAdmin.value) return <Screen><TopBar title="Map" backTo="/a" /><div class="screen-body"><Empty icon="lock" title="Owners only" /></div></Screen>;
  const data = d.data;
  const onDuty = (data?.status ?? []).filter((s) => s.on_duty && s.time_entry_id && s.lat != null && s.lng != null);
  const sites: SitePin[] = (data?.sites ?? []).filter((s) => s.active !== false && s.lat != null && s.lng != null).map((s) => ({
    id: s.id, lat: s.lat!, lng: s.lng!, name: s.name, address: [s.address, s.city].filter(Boolean).join(', '),
    onDuty: onDuty.filter((x) => x.site_id === s.id).length,
    photo: async () => { const c = await siteCover(s.id); return c ? sitePhotoUrl(c, true) : null; },
  }));
  const guards: GuardPin[] = onDuty.map((st) => ({
    id: st.member_id, lat: st.lat!, lng: st.lng!,
    name: data?.members.find((m) => m.id === st.member_id)?.display_name ?? 'Guard',
    site: data?.sites.find((s) => s.id === st.site_id)?.name ?? '',
    seen: st.last_ping_at ? `GPS ${relTime(st.last_ping_at)}` : 'GPS at clock-in',
  }));
  return (
    <Screen>
      <TopBar title="Map" backTo="/a" right={<SyncPill />} sub={`${sites.length} site${sites.length === 1 ? '' : 's'} · ${guards.length} on duty`} />
      <div class="screen-body stack">
        {data && <OwnerMapView sites={sites} guards={guards} height={Math.max(360, Math.round(window.innerHeight - 220))} />}
        <p class="foot faint">Guards appear only while clocked in, at their latest GPS point (clock-in, scan, log entry or location update). Visible to owners only.</p>
      </div>
    </Screen>
  );
}
