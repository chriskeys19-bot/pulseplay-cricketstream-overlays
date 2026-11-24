-- Pulse Play admins who are not Cheetahs Club admins.
-- Does not read or write public.profiles. cricketforcubs@gmail.com stays a
-- pending player in the club app and gains only this Pulse Play list.

create table if not exists public.pp_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,
  constraint pp_admins_email_normalized check (email = lower(btrim(email)))
);

create unique index if not exists pp_admins_email_key on public.pp_admins (email);
create index if not exists pp_admins_user_id_idx on public.pp_admins (user_id);

comment on table public.pp_admins is
  'Pulse Play dashboard admins. Independent of public.profiles, so club access stays unchanged.';

alter table public.pp_admins enable row level security;

grant select, insert, update, delete on public.pp_admins to authenticated;
grant select, insert, update, delete on public.pp_admins to service_role;

create or replace function private.is_pp_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select private.current_role()) = 'admin', false)
    or exists (
      select 1
      from public.pp_admins as a
      where a.active = true
        and (
          a.user_id = (select auth.uid())
          or exists (
            select 1
            from auth.users as u
            where u.id = (select auth.uid())
              and u.email_confirmed_at is not null
              and lower(u.email) = lower(a.email)
          )
        )
    );
$$;

revoke all on function private.is_pp_admin() from public;
grant execute on function private.is_pp_admin() to authenticated;

drop policy if exists pp_admins_admin_all on public.pp_admins;
create policy pp_admins_admin_all on public.pp_admins
  for all to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

drop policy if exists pp_admins_self_select on public.pp_admins;
create policy pp_admins_self_select on public.pp_admins
  for select to authenticated
  using (
    active = true
    and (
      user_id = (select auth.uid())
      or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    )
    and (select private.is_pp_admin())
  );

insert into public.pp_admins (email, user_id, active)
select
  'cricketforcubs@gmail.com',
  (select id from auth.users where lower(email) = 'cricketforcubs@gmail.com' limit 1),
  true
on conflict (email) do update
  set active = true,
      user_id = coalesce(public.pp_admins.user_id, excluded.user_id);

-- Pulse Play writes accept either a club admin or a pp_admins row.
-- Public renderer reads and division-operator policies stay as they are.

drop policy if exists pp_settings_admin_write on public.pp_settings;
create policy pp_settings_admin_write on public.pp_settings
  for all to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

drop policy if exists pp_assets_admin_write on public.pp_assets;
create policy pp_assets_admin_write on public.pp_assets
  for all to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

drop policy if exists pp_grounds_admin_write on public.pp_grounds;
create policy pp_grounds_admin_write on public.pp_grounds
  for all to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

drop policy if exists pp_ground_ads_admin_write on public.pp_ground_ads;
create policy pp_ground_ads_admin_write on public.pp_ground_ads
  for all to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

drop policy if exists pp_streams_admin_select on public.pp_streams;
drop policy if exists pp_streams_read on public.pp_streams;
create policy pp_streams_read on public.pp_streams
  for select to authenticated
  using (
    (select private.is_pp_admin())
    or (select private.pp_is_operator_for(division))
  );

drop policy if exists pp_streams_admin_update on public.pp_streams;
create policy pp_streams_admin_update on public.pp_streams
  for update to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

drop policy if exists pp_operators_admin_select on public.pp_operators;
create policy pp_operators_admin_select on public.pp_operators
  for select to authenticated
  using ((select private.is_pp_admin()));

drop policy if exists pp_operators_admin_write on public.pp_operators;
create policy pp_operators_admin_write on public.pp_operators
  for all to authenticated
  using ((select private.is_pp_admin()))
  with check ((select private.is_pp_admin()));

grant insert, update, delete on public.pp_operators to authenticated;

drop policy if exists pp_assets_bucket_insert on storage.objects;
create policy pp_assets_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pulseplay-assets'
    and (select private.is_pp_admin())
  );

drop policy if exists pp_assets_bucket_update on storage.objects;
create policy pp_assets_bucket_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pulseplay-assets'
    and (select private.is_pp_admin())
  )
  with check (
    bucket_id = 'pulseplay-assets'
    and (select private.is_pp_admin())
  );

drop policy if exists pp_assets_bucket_delete on storage.objects;
create policy pp_assets_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pulseplay-assets'
    and (select private.is_pp_admin())
  );
