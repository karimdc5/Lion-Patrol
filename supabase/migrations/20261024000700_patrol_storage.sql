-- Lion Patrol v2 — private media bucket + storage.objects policies (scoped to this bucket only).
-- Object visibility == attachment row visibility == parent record visibility.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patrol-media', 'patrol-media', false, 52428800, array[
  'image/jpeg','image/png','image/webp','image/heic','image/heif',
  'video/mp4','video/quicktime','video/webm',
  'audio/mp4','audio/x-m4a','audio/aac','audio/mpeg','audio/wav','audio/webm','audio/ogg',
  'application/pdf'])
on conflict (id) do nothing;

drop policy if exists patrol_media_select on storage.objects;
create policy patrol_media_select on storage.objects for select to authenticated
using (
  bucket_id = 'patrol-media'
  and exists (select 1 from public.patrol_attachments a
              where a.storage_path = storage.objects.name or a.thumb_path = storage.objects.name)
);

drop policy if exists patrol_media_insert on storage.objects;
create policy patrol_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'patrol-media'
  and (storage.foldername(name))[1] = any (select unnest((select public.patrol_worker_orgs()))::text)
  and exists (select 1 from public.patrol_attachments a
              where (a.storage_path = storage.objects.name or a.thumb_path = storage.objects.name)
                and a.member_id = any ((select public.patrol_my_member_ids())::uuid[])
                and a.upload_status = 'pending')
);

drop policy if exists patrol_media_update on storage.objects;
create policy patrol_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'patrol-media'
  and exists (select 1 from public.patrol_attachments a
              where (a.storage_path = storage.objects.name or a.thumb_path = storage.objects.name)
                and a.member_id = any ((select public.patrol_my_member_ids())::uuid[])
                and a.upload_status = 'pending')
)
with check (
  bucket_id = 'patrol-media'
  and (storage.foldername(name))[1] = any (select unnest((select public.patrol_worker_orgs()))::text)
);

drop policy if exists patrol_media_delete on storage.objects;
create policy patrol_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'patrol-media'
  and (
    (storage.foldername(name))[1] = any (select unnest((select public.patrol_admin_orgs()))::text)
    or exists (select 1 from public.patrol_attachments a
               where (a.storage_path = storage.objects.name or a.thumb_path = storage.objects.name)
                 and a.member_id = any ((select public.patrol_my_member_ids())::uuid[])
                 and a.upload_status = 'pending')
  )
);

commit;
