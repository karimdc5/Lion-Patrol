-- Lion Patrol v2 — item 12: end-of-shift PDF stored on the shift (patrol_attachments parent 'shift' =
-- patrol_time_entries.id). Re-runnable; patrol_ objects only. The new enum value is compared as text
-- because it can't be used in the transaction that adds it.
begin;

alter type public.patrol_attach_parent add value if not exists 'shift';

-- Read: the guard who worked the shift + staff of the org (time-entry visibility).
drop policy if exists patrol_attachments_select on public.patrol_attachments;
create policy patrol_attachments_select on public.patrol_attachments as permissive for select to authenticated using (
  member_id = any ((select public.patrol_my_member_ids())::uuid[]) or (case parent_type::text
    when 'incident' then exists (select 1 from public.patrol_incidents p where p.id = parent_id)
    when 'dar_entry' then exists (select 1 from public.patrol_dar_entries p where p.id = parent_id)
    when 'scan' then exists (select 1 from public.patrol_scans p where p.id = parent_id)
    when 'alert' then exists (select 1 from public.patrol_alerts p where p.id = parent_id)
    when 'site' then exists (select 1 from public.patrol_sites p where p.id = parent_id)
    when 'bolo' then exists (select 1 from public.patrol_bolos p where p.id = parent_id)
    when 'shift' then exists (select 1 from public.patrol_time_entries p where p.id = parent_id
                              and p.org_id = any ((select public.patrol_staff_orgs())::uuid[]))
    else false end));

create or replace function public.patrol_attachment_before_insert()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid; v_site uuid; v_member uuid;
begin
  if new.parent_type = 'incident' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_incidents where id = new.parent_id;
  elsif new.parent_type = 'dar_entry' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_dar_entries where id = new.parent_id;
  elsif new.parent_type = 'scan' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_scans where id = new.parent_id;
  elsif new.parent_type = 'alert' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_alerts where id = new.parent_id;
  elsif new.parent_type = 'site' then
    select org_id, id into v_org, v_site from public.patrol_sites where id = new.parent_id;
  elsif new.parent_type::text = 'bolo' then
    select org_id, site_id, created_by into v_org, v_site, v_member from public.patrol_bolos where id = new.parent_id;
  elsif new.parent_type::text = 'shift' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_time_entries where id = new.parent_id;
  end if;
  if v_org is null then raise exception 'attachment_parent_not_found' using errcode = '23503'; end if;
  if v_org <> new.org_id then raise exception 'attachment_org_mismatch' using errcode = '42501'; end if;
  if current_user = 'authenticated' then
    if new.parent_type = 'site' then
      if not (new.org_id = any(public.patrol_admin_orgs())) then
        raise exception 'attachment_not_allowed' using errcode = '42501';
      end if;
    elsif new.parent_type::text = 'shift' then
      if new.kind <> 'document' or (v_member <> new.member_id and not (new.org_id = any(public.patrol_staff_orgs()))) then
        raise exception 'attachment_not_allowed' using errcode = '42501';
      end if;
    elsif v_member <> new.member_id then
      raise exception 'attachment_not_allowed' using errcode = '42501';
    end if;
  end if;
  if left(new.storage_path, 37) <> new.org_id::text || '/' then
    raise exception 'attachment_bad_path' using errcode = '23514';
  end if;
  if new.thumb_path is not null and left(new.thumb_path, 37) <> new.org_id::text || '/' then
    raise exception 'attachment_bad_path' using errcode = '23514';
  end if;
  new.site_id := v_site;
  new.upload_status := 'pending';
  new.uploaded_at := null;
  return new;
end $$;
drop trigger if exists patrol_10_check on public.patrol_attachments;
create trigger patrol_10_check before insert on public.patrol_attachments
  for each row execute function public.patrol_attachment_before_insert();
revoke all on function public.patrol_attachment_before_insert() from public, anon;

commit;
