-- When a ground uses the external SRT ad stream, the web overlay stays
-- transparent during a video ad. duration_seconds is how long that ad
-- runs, so the page can return to logos without a local video element.
-- RLS is unchanged: anonymous read, admin write.

alter table public.pp_grounds
  add column if not exists external_video_audio boolean not null default false;

alter table public.pp_assets
  add column if not exists duration_seconds numeric;

alter table public.pp_assets
  drop constraint if exists pp_assets_duration_seconds_check;

alter table public.pp_assets
  add constraint pp_assets_duration_seconds_check
  check (
    duration_seconds is null
    or (kind = 'ad' and duration_seconds > 0 and duration_seconds < 86400)
  );

update public.pp_assets set duration_seconds = 27.008
  where id = 'upload-1795108556207' and duration_seconds is null;
update public.pp_assets set duration_seconds = 64.916
  where id = 'upload-1795107929957' and duration_seconds is null;
update public.pp_assets set duration_seconds = 15
  where id = 'upload-1795108590591' and duration_seconds is null;
update public.pp_assets set duration_seconds = 30.030
  where id = 'upload-1795108481799' and duration_seconds is null;
