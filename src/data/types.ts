// Row shapes for the patrol_* tables (subset of columns the client uses).
export type Role = 'owner' | 'admin' | 'supervisor' | 'guard' | 'client';
export interface Member { id: string; org_id: string; user_id: string; role: Role; status: 'active' | 'disabled'; display_name: string; email?: string | null; phone?: string | null; badge_no?: string | null }
export interface Org { id: string; name: string; timezone: string; phone?: string | null; email?: string | null; address?: string | null; license_no?: string | null; legal_name?: string | null }
export interface OrgSettings { org_id: string; notify_emails: string[]; client_notifications_enabled: boolean; auto_share_with_client: boolean; report_prefix: string; gps_ping_interval_s: number; ping_retention_days: number; max_video_mb: number; max_video_s: number; tour_interval_min: number; tour_max_duration_min: number; email_enabled?: boolean; email_min_severity?: string; email_owners_only?: boolean }
export interface PublicSettings { org_id: string; gps_ping_interval_s: number; max_video_mb: number; max_video_s: number; tour_interval_min: number; tour_max_duration_min: number; report_prefix: string }
export interface Site { id: string; org_id: string; name: string; code: string | null; kind: 'retail' | 'apartment' | 'other'; address: string | null; city: string | null; state: string | null; zip: string | null; lat: number | null; lng: number | null; geofence_m: number; post_orders_html: string; post_orders_updated_at: string | null; contacts: Array<{ name: string; role?: string; phone?: string; email?: string; notes?: string }>; tour_interval_min: number | null; tour_max_duration_min: number | null; active: boolean; timezone?: string | null }
export interface SiteAccess { org_id: string; site_id: string; member_id: string; id?: string }
export interface Checkpoint { id: string; org_id: string; site_id: string; name: string; seq: number; code: string; lat: number | null; lng: number | null; radius_m: number; instructions: string | null; active: boolean }
export interface Category { id: string; org_id: string; name: string; color: string; icon: string; sort: number; hidden: boolean; required_fields: string[]; default_severity: string; use_for: 'incident' | 'dar' | 'both' }
export interface Subtype { id: string; org_id: string; category_id: string; name: string; sort: number; hidden: boolean }
export interface Shift { id: string; org_id: string; site_id: string; member_id: string | null; starts_at: string; ends_at: string; notes: string | null; cancelled_at: string | null }
export interface TimeEntry { id: string; org_id: string; site_id: string; member_id: string; shift_id: string | null; clock_in_at: string; clock_in_lat: number | null; clock_in_lng: number | null; clock_out_at: string | null; shift_note: string | null; gps_notice_accepted_at: string }
export interface Consent { id: string; org_id: string; member_id: string; kind: 'gps_notice' | 'audio_notice'; version: number; accepted_at: string }
export interface MemberStatus { member_id: string; org_id: string; on_duty: boolean; site_id: string | null; time_entry_id: string | null; lat: number | null; lng: number | null; last_ping_at: string | null; on_duty_since: string | null }

export interface Bootstrap {
  user_id: string;
  is_app_admin: boolean;
  server_time: string;
  memberships: Member[];
  orgs: Org[];
  settings: OrgSettings[];
  public_settings: PublicSettings[];
  members: Member[];
  sites: Site[];
  site_access: SiteAccess[];
  checkpoints: Checkpoint[];
  categories: Category[];
  subtypes: Subtype[];
  shifts: Shift[];
  open_time_entries: TimeEntry[];
  open_dars: Array<Record<string, unknown> & { id: string }>;
  open_tour_runs: Array<Record<string, unknown> & { id: string }>;
  consents: Consent[];
  member_status: MemberStatus[];
}
