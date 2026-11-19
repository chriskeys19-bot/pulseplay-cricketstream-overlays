-- Image ads live in pp_assets next to videos. Logos stay without a media type.
-- Existing ads are videos. RLS on pp_assets is unchanged: anon can read, admins write.
alter table public.pp_assets add column if not exists media_type text;

update public.pp_assets
set media_type = 'video'
where kind = 'ad'
  and media_type is null;

alter table public.pp_assets drop constraint if exists pp_assets_media_type_check;

alter table public.pp_assets
  add constraint pp_assets_media_type_check
  check (
    (kind = 'ad' and media_type in ('video', 'image'))
    or (kind = 'logo' and media_type is null)
  );
