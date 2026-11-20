-- Grounds play video-ad audio unless an admin turns it off.
-- Existing rows default to on. RLS is unchanged.

alter table public.pp_grounds
  add column if not exists play_audio boolean not null default true;
