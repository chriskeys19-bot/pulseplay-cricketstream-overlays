-- Shared CricketCraze stream list. The Stream Bot inserts later rows
-- with the service role. Signed-in Pulse Play admins can read and update.
-- Same admin check as pp_grounds: private.current_role() = 'admin'.

create table if not exists public.pp_streams (
  id text primary key,
  event text not null,
  date date not null,
  start_local text not null,
  timezone text not null,
  ground text not null,
  division text not null,
  team1 text not null,
  team2 text not null,
  stream_key text not null,
  video_id text not null,
  auto_start boolean not null default false,
  overlay_url text,
  status text,
  updated_at timestamptz not null default now()
);

comment on table public.pp_streams is
  'Games the CricketCraze Stream Bot and Pulse Play admin share. Service role inserts. Admins read and update.';

alter table public.pp_streams enable row level security;

grant select, update on public.pp_streams to authenticated;
grant select, insert, update, delete on public.pp_streams to service_role;

drop policy if exists pp_streams_admin_select on public.pp_streams;
create policy pp_streams_admin_select on public.pp_streams
  for select to authenticated
  using ((select private.current_role()) = 'admin');

drop policy if exists pp_streams_admin_update on public.pp_streams;
create policy pp_streams_admin_update on public.pp_streams
  for update to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');
