-- Pulse Play access grants. Additive and pp_-prefixed.
-- Does not read or write public.profiles, and does not change Cheetahs Club
-- tables. Existing pp_admins rows become scope "all" admins. pp_admins stays
-- a real table: a trigger mirrors full-admin grants so private.is_pp_admin()
-- and the old dashboard check keep working.

create table if not exists public.pp_access_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users (id) on delete set null,
  scope_type text not null,
  tournament text,
  division text,
  role text not null,
  status text not null default 'pending',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pp_access_grants_email_normalized check (email = lower(btrim(email))),
  constraint pp_access_grants_scope_type check (scope_type in ('all', 'tournament', 'division')),
  constraint pp_access_grants_role check (role in ('admin', 'operator')),
  constraint pp_access_grants_status check (status in ('pending', 'active', 'revoked')),
  constraint pp_access_grants_tournament check (
    tournament is null or tournament ~ '^[A-Z][A-Z0-9]{1,11}$'
  ),
  constraint pp_access_grants_division check (
    division is null or division in ('U9', 'U11', 'U13', 'U15', 'U17', 'U19')
  ),
  constraint pp_access_grants_shape check (
    (scope_type = 'all' and tournament is null and division is null)
    or (scope_type = 'tournament' and tournament is not null and division is null)
    or (scope_type = 'division' and division is not null)
  )
);

create unique index if not exists pp_access_grants_identity_key
  on public.pp_access_grants (
    email,
    scope_type,
    coalesce(tournament, ''),
    coalesce(division, ''),
    role
  );

create index if not exists pp_access_grants_email_idx on public.pp_access_grants (email);
create index if not exists pp_access_grants_user_idx on public.pp_access_grants (user_id);
create index if not exists pp_access_grants_status_idx on public.pp_access_grants (status);
create index if not exists pp_streams_event_division_idx on public.pp_streams (event, division);

comment on table public.pp_access_grants is
  'Pulse Play dashboard access. Independent of public.profiles. scope all is every tournament, tournament is one event, division is an age group in one tournament or in every tournament.';

alter table public.pp_access_grants enable row level security;

grant select, insert, update, delete on public.pp_access_grants to authenticated;
grant select, insert, update, delete on public.pp_access_grants to service_role;

create or replace function private.pp_touch_access_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pp_access_grants_touch on public.pp_access_grants;
create trigger pp_access_grants_touch
  before update on public.pp_access_grants
  for each row execute function private.pp_touch_access_grant();

revoke all on function private.pp_touch_access_grant() from public;

-- True when the signed-in user owns this grant. Email matches only a
-- confirmed auth.users row, never a client-editable metadata claim.
create or replace function private.pp_grant_is_caller(p_user_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null and p_user_id = (select auth.uid())
    or exists (
      select 1
      from auth.users as u
      where u.id = (select auth.uid())
        and u.email_confirmed_at is not null
        and lower(u.email) = lower(p_email)
    );
$$;

revoke all on function private.pp_grant_is_caller(uuid, text) from public;
grant execute on function private.pp_grant_is_caller(uuid, text) to authenticated;

create or replace function private.pp_grant_covers(p_tournament text, p_division text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pp_access_grants as g
    where g.status = 'active'
      and private.pp_grant_is_caller(g.user_id, g.email)
      and (
        g.scope_type = 'all'
        or (
          g.scope_type = 'tournament'
          and g.tournament = upper(btrim(coalesce(p_tournament, '')))
        )
        or (
          g.scope_type = 'division'
          and g.division = upper(btrim(coalesce(p_division, '')))
          and (
            g.tournament is null
            or g.tournament = upper(btrim(coalesce(p_tournament, '')))
          )
        )
      )
  );
$$;

revoke all on function private.pp_grant_covers(text, text) from public;
grant execute on function private.pp_grant_covers(text, text) to authenticated;

create or replace function private.pp_admin_grant_covers(p_tournament text, p_division text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pp_access_grants as g
    where g.status = 'active'
      and g.role = 'admin'
      and private.pp_grant_is_caller(g.user_id, g.email)
      and (
        g.scope_type = 'all'
        or (
          g.scope_type = 'tournament'
          and g.tournament = upper(btrim(coalesce(p_tournament, '')))
        )
        or (
          g.scope_type = 'division'
          and g.division = upper(btrim(coalesce(p_division, '')))
          and (
            g.tournament is null
            or g.tournament = upper(btrim(coalesce(p_tournament, '')))
          )
        )
      )
  );
$$;

revoke all on function private.pp_admin_grant_covers(text, text) from public;
grant execute on function private.pp_admin_grant_covers(text, text) to authenticated;

-- Full admins, and tournament admins inside their own tournament.
-- A tournament admin cannot grant "all tournaments" or another tournament.
create or replace function private.pp_can_manage_grant(
  p_scope text,
  p_tournament text,
  p_division text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_pp_admin())
    or exists (
      select 1
      from public.pp_access_grants as g
      where g.status = 'active'
        and g.role = 'admin'
        and g.scope_type = 'tournament'
        and g.tournament is not null
        and private.pp_grant_is_caller(g.user_id, g.email)
        and p_scope <> 'all'
        and (
          (
            p_scope = 'tournament'
            and upper(btrim(coalesce(p_tournament, ''))) = g.tournament
          )
          or (
            p_scope = 'division'
            and p_tournament is not null
            and upper(btrim(p_tournament)) = g.tournament
          )
        )
    );
$$;

revoke all on function private.pp_can_manage_grant(text, text, text) from public;
grant execute on function private.pp_can_manage_grant(text, text, text) to authenticated;

create or replace function private.pp_ground_matches(p_id text, p_name text, p_stream_ground text)
returns boolean
language sql
immutable
as $$
  select
    lower(btrim(coalesce(p_stream_ground, ''))) = lower(btrim(coalesce(p_name, '')))
    or lower(btrim(coalesce(p_stream_ground, ''))) = lower(btrim(coalesce(p_id, '')))
    or exists (
      select 1
      from (
        values
          ('stanford', 'stanfordu9'),
          ('cts west', 'ctsu11'),
          ('4leaf east', '4leaf'),
          ('sycamore 2', 'sycamore2'),
          ('pms-1', 'pms1'),
          ('pms1', 'pms1')
      ) as alias (stream_ground, ground_id)
      where alias.stream_ground = lower(btrim(coalesce(p_stream_ground, '')))
        and alias.ground_id = lower(btrim(coalesce(p_id, '')))
    );
$$;

revoke all on function private.pp_ground_matches(text, text, text) from public;

create or replace function private.pp_ground_visible(p_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pp_streams as s
    where private.pp_grant_covers(s.event, s.division)
      and private.pp_ground_matches(p_id, p_name, s.ground)
  );
$$;

revoke all on function private.pp_ground_visible(text, text) from public;
grant execute on function private.pp_ground_visible(text, text) to authenticated;

create or replace function private.pp_can_write_ground(p_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pp_streams as s
    where private.pp_admin_grant_covers(s.event, s.division)
      and private.pp_ground_matches(p_id, p_name, s.ground)
  );
$$;

revoke all on function private.pp_can_write_ground(text, text) from public;
grant execute on function private.pp_can_write_ground(text, text) to authenticated;

-- Service role only. The edge function looks up auth.users without a
-- management PAT. Authenticated callers cannot execute it.
create or replace function public.pp_auth_user_by_email(p_email text)
returns table (id uuid, email_confirmed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select u.id, u.email_confirmed_at
  from auth.users as u
  where lower(u.email) = lower(btrim(coalesce(p_email, '')))
  limit 1;
end;
$$;

revoke all on function public.pp_auth_user_by_email(text) from public;
revoke all on function public.pp_auth_user_by_email(text) from anon;
revoke all on function public.pp_auth_user_by_email(text) from authenticated;
grant execute on function public.pp_auth_user_by_email(text) to service_role;

comment on function public.pp_auth_user_by_email(text) is
  'Service-role lookup of auth.users by email for Pulse Play invites. Not granted to anon or authenticated.';

drop policy if exists pp_access_grants_select on public.pp_access_grants;
create policy pp_access_grants_select on public.pp_access_grants
  for select to authenticated
  using (
    (select private.pp_grant_is_caller(user_id, email))
    or (select private.pp_can_manage_grant(scope_type, tournament, division))
  );

drop policy if exists pp_access_grants_insert on public.pp_access_grants;
create policy pp_access_grants_insert on public.pp_access_grants
  for insert to authenticated
  with check ((select private.pp_can_manage_grant(scope_type, tournament, division)));

drop policy if exists pp_access_grants_update on public.pp_access_grants;
create policy pp_access_grants_update on public.pp_access_grants
  for update to authenticated
  using ((select private.pp_can_manage_grant(scope_type, tournament, division)))
  with check ((select private.pp_can_manage_grant(scope_type, tournament, division)));

drop policy if exists pp_access_grants_delete on public.pp_access_grants;
create policy pp_access_grants_delete on public.pp_access_grants
  for delete to authenticated
  using ((select private.pp_can_manage_grant(scope_type, tournament, division)));

-- Keep pp_admins aligned with scope "all" admin grants.
create or replace function private.pp_refresh_admin_mirror(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_id uuid;
  active_user uuid;
  active_inviter uuid;
begin
  select g.id, g.user_id, g.invited_by
    into active_id, active_user, active_inviter
  from public.pp_access_grants as g
  where g.email = p_email
    and g.scope_type = 'all'
    and g.role = 'admin'
    and g.status = 'active'
  limit 1;

  if active_id is not null then
    insert into public.pp_admins (email, user_id, active, added_by)
    values (p_email, active_user, true, active_inviter)
    on conflict (email) do update
      set active = true,
          user_id = coalesce(public.pp_admins.user_id, excluded.user_id),
          added_by = coalesce(public.pp_admins.added_by, excluded.added_by);
  else
    update public.pp_admins
    set active = false
    where email = p_email;
  end if;
end;
$$;

revoke all on function private.pp_refresh_admin_mirror(text) from public;

create or replace function private.pp_access_grants_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.email is distinct from new.email then
    perform private.pp_refresh_admin_mirror(old.email);
  end if;
  if tg_op = 'DELETE' then
    perform private.pp_refresh_admin_mirror(old.email);
    return old;
  end if;
  perform private.pp_refresh_admin_mirror(new.email);
  return new;
end;
$$;

revoke all on function private.pp_access_grants_mirror() from public;

drop trigger if exists pp_access_grants_mirror on public.pp_access_grants;
create trigger pp_access_grants_mirror
  after insert or update or delete on public.pp_access_grants
  for each row execute function private.pp_access_grants_mirror();

insert into public.pp_access_grants (
  email, user_id, scope_type, tournament, division, role, status, invited_by, created_at
)
select
  a.email,
  a.user_id,
  'all',
  null,
  null,
  'admin',
  case when a.active then 'active' else 'revoked' end,
  a.added_by,
  a.created_at
from public.pp_admins as a
where not exists (
  select 1
  from public.pp_access_grants as g
  where g.email = a.email
    and g.scope_type = 'all'
    and g.role = 'admin'
    and g.tournament is null
    and g.division is null
);

insert into public.pp_access_grants (
  email, user_id, scope_type, tournament, division, role, status, invited_by, created_at
)
select
  o.email,
  o.user_id,
  'division',
  null,
  d.division,
  'operator',
  case when o.active then 'active' else 'revoked' end,
  o.invited_by,
  o.created_at
from public.pp_operators as o
cross join lateral unnest(o.divisions) as d (division)
where not exists (
  select 1
  from public.pp_access_grants as g
  where g.email = o.email
    and g.scope_type = 'division'
    and g.role = 'operator'
    and g.tournament is null
    and g.division = d.division
);

-- Streams: a grant can see the games it covers. Operators and full admins stay.
drop policy if exists pp_streams_read on public.pp_streams;
create policy pp_streams_read on public.pp_streams
  for select to authenticated
  using (
    (select private.is_pp_admin())
    or (select private.pp_is_operator_for(division))
    or (select private.pp_grant_covers(event, division))
  );

drop policy if exists pp_streams_admin_update on public.pp_streams;
create policy pp_streams_admin_update on public.pp_streams
  for update to authenticated
  using (
    (select private.is_pp_admin())
    or (select private.pp_admin_grant_covers(event, division))
  )
  with check (
    (select private.is_pp_admin())
    or (select private.pp_admin_grant_covers(event, division))
  );

-- Grounds stay public for signed-out renderers. The dashboard is signed in,
-- so authenticated reads and writes follow the caller's scope. Command Center
-- (the live wall) reads the same ground rows.
drop policy if exists pp_grounds_select on public.pp_grounds;
drop policy if exists pp_grounds_select_anon on public.pp_grounds;
create policy pp_grounds_select_anon on public.pp_grounds
  for select to anon
  using (true);

drop policy if exists pp_grounds_select_auth on public.pp_grounds;
create policy pp_grounds_select_auth on public.pp_grounds
  for select to authenticated
  using (
    (select private.is_pp_admin())
    or (select private.pp_ground_visible(id, name))
  );

drop policy if exists pp_grounds_admin_write on public.pp_grounds;
drop policy if exists pp_grounds_admin_insert on public.pp_grounds;
create policy pp_grounds_admin_insert on public.pp_grounds
  for insert to authenticated
  with check (
    (select private.is_pp_admin())
    or (select private.pp_can_write_ground(id, name))
  );

drop policy if exists pp_grounds_admin_delete on public.pp_grounds;
create policy pp_grounds_admin_delete on public.pp_grounds
  for delete to authenticated
  using ((select private.is_pp_admin()));

drop policy if exists pp_grounds_admin_update on public.pp_grounds;
create policy pp_grounds_admin_update on public.pp_grounds
  for update to authenticated
  using (
    (select private.is_pp_admin())
    or (select private.pp_can_write_ground(id, name))
  )
  with check (
    (select private.is_pp_admin())
    or (select private.pp_can_write_ground(id, name))
  );

drop policy if exists pp_ground_ads_select on public.pp_ground_ads;
drop policy if exists pp_ground_ads_select_anon on public.pp_ground_ads;
create policy pp_ground_ads_select_anon on public.pp_ground_ads
  for select to anon
  using (true);

drop policy if exists pp_ground_ads_select_auth on public.pp_ground_ads;
create policy pp_ground_ads_select_auth on public.pp_ground_ads
  for select to authenticated
  using (
    (select private.is_pp_admin())
    or exists (
      select 1
      from public.pp_grounds as g
      where g.id = ground_id
        and (select private.pp_ground_visible(g.id, g.name))
    )
  );

drop policy if exists pp_ground_ads_admin_write on public.pp_ground_ads;
drop policy if exists pp_ground_ads_scope_write on public.pp_ground_ads;
create policy pp_ground_ads_scope_write on public.pp_ground_ads
  for all to authenticated
  using (
    (select private.is_pp_admin())
    or exists (
      select 1
      from public.pp_grounds as g
      where g.id = ground_id
        and (select private.pp_can_write_ground(g.id, g.name))
    )
  )
  with check (
    (select private.is_pp_admin())
    or exists (
      select 1
      from public.pp_grounds as g
      where g.id = ground_id
        and (select private.pp_can_write_ground(g.id, g.name))
    )
  );
