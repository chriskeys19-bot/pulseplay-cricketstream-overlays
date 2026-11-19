-- Pulse Play overlay tables for the existing cheetahs-club project.
-- Separate from the club app: every new relation is pp_-prefixed.
-- Does not alter profiles, teams, policies, or functions that already exist.
-- Admin checks call private.current_role(), the club helper that reads
-- profiles.role. It is not recreated here.
--
-- Apply this by hand after review. The app keeps adapter: "mock" until then.

create table public.pp_settings (
  id integer primary key check (id = 1),
  poll_ms integer not null default 2000 check (poll_ms between 500 and 30000),
  auto_return_on_end boolean not null default true
);

insert into public.pp_settings (id) values (1);

create table public.pp_assets (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  kind text not null check (kind in ('ad', 'logo')),
  label text not null,
  description text not null default '',
  storage_path text not null,
  mime text,
  size bigint,
  logo_type text check (
    logo_type is null
    or logo_type in ('age_group_sponsor', 'tournament', 'cricketcraze', 'other')
  ),
  auto_return boolean,
  created_at timestamptz not null default now(),
  check (
    (kind = 'ad' and logo_type is null)
    or (kind = 'logo' and logo_type is not null)
  )
);

create table public.pp_grounds (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null,
  short_link text not null,
  resolved_url text not null,
  device text not null check (device in ('pro', 'mini')),
  score_url text not null,
  logo_age_id text references public.pp_assets (id) on delete set null,
  logo_tournament_id text references public.pp_assets (id) on delete set null,
  logo_cricketcraze_id text references public.pp_assets (id) on delete set null,
  mode text not null default 'logos_score' check (mode in ('logos_score', 'ad')),
  active_ad_id text references public.pp_assets (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.pp_ground_ads (
  ground_id text not null references public.pp_grounds (id) on delete cascade,
  asset_id text not null references public.pp_assets (id) on delete cascade,
  position integer not null default 0,
  primary key (ground_id, asset_id)
);

create index pp_ground_ads_asset_idx on public.pp_ground_ads (asset_id);
create index pp_assets_kind_idx on public.pp_assets (kind);

alter table public.pp_settings enable row level security;
alter table public.pp_assets enable row level security;
alter table public.pp_grounds enable row level security;
alter table public.pp_ground_ads enable row level security;

grant select on public.pp_settings, public.pp_assets, public.pp_grounds, public.pp_ground_ads
  to anon, authenticated;
grant insert, update, delete on public.pp_settings, public.pp_assets, public.pp_grounds, public.pp_ground_ads
  to authenticated;

-- Renderers are anonymous. They only need to read.
create policy pp_settings_select on public.pp_settings
  for select to anon, authenticated using (true);
create policy pp_assets_select on public.pp_assets
  for select to anon, authenticated using (true);
create policy pp_grounds_select on public.pp_grounds
  for select to anon, authenticated using (true);
create policy pp_ground_ads_select on public.pp_ground_ads
  for select to anon, authenticated using (true);

-- Writes reuse the club admin check. private.current_role() is security
-- definer and already granted to authenticated. Anon cannot call it, and
-- these policies are not for anon.
create policy pp_settings_admin_write on public.pp_settings
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy pp_assets_admin_write on public.pp_assets
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy pp_grounds_admin_write on public.pp_grounds
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy pp_ground_ads_admin_write on public.pp_ground_ads
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

-- Realtime on ground state so a later subscriber can skip the poll.
-- Polling remains the fallback in the client.
do $$
begin
  alter publication supabase_realtime add table public.pp_grounds;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Public read bucket. 200 MB per file. The project shares the 1 GB
-- Storage free tier with the club app, so keep commercials short.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pulseplay-assets',
  'pulseplay-assets',
  true,
  209715200,
  array['video/mp4', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

create policy pp_assets_bucket_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'pulseplay-assets');

create policy pp_assets_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pulseplay-assets'
    and (select private.current_role()) = 'admin'
  );

create policy pp_assets_bucket_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pulseplay-assets'
    and (select private.current_role()) = 'admin'
  )
  with check (
    bucket_id = 'pulseplay-assets'
    and (select private.current_role()) = 'admin'
  );

create policy pp_assets_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pulseplay-assets'
    and (select private.current_role()) = 'admin'
  );
