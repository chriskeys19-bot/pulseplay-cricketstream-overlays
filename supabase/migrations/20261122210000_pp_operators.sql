-- Division operators for the Pulse Play streams dashboard.
-- Apply after 20261122070000_pp_streams.sql. Admins stay on private.current_role().
-- Operators may read only the pp_streams rows in their divisions. They cannot
-- insert or update streams. The service role writes operator rows.

create table if not exists public.pp_operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text not null unique,
  divisions text[] not null,
  invited_by uuid,
  created_at timestamptz not null default now(),
  active boolean not null default true,
  constraint pp_operators_email_lower check (email = lower(email)),
  constraint pp_operators_divisions_known check (
    cardinality(divisions) > 0
    and divisions <@ array['U9', 'U11', 'U13', 'U15']::text[]
  )
);

create unique index if not exists pp_operators_user_id_key
  on public.pp_operators (user_id)
  where user_id is not null;

comment on table public.pp_operators is
  'Pulse Play division operators. Admins invite them. Active rows can read and start only their divisions.';

alter table public.pp_operators enable row level security;

grant select on public.pp_operators to authenticated;
grant select, insert, update, delete on public.pp_operators to service_role;

drop policy if exists pp_operators_admin_select on public.pp_operators;
create policy pp_operators_admin_select on public.pp_operators
  for select to authenticated
  using ((select private.current_role()) = 'admin');

drop policy if exists pp_operators_self_select on public.pp_operators;
create policy pp_operators_self_select on public.pp_operators
  for select to authenticated
  using (
    active = true
    and (
      user_id = (select auth.uid())
      or (
        user_id is null
        and email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
      )
    )
  );

create or replace function private.pp_is_operator_for(p_division text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pp_operators
    where active = true
      and p_division = any (divisions)
      and (
        user_id = (select auth.uid())
        or (
          user_id is null
          and email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
        )
      )
  );
$$;

revoke all on function private.pp_is_operator_for(text) from public;
grant execute on function private.pp_is_operator_for(text) to authenticated;

drop policy if exists pp_streams_admin_select on public.pp_streams;
drop policy if exists pp_streams_read on public.pp_streams;
create policy pp_streams_read on public.pp_streams
  for select to authenticated
  using (
    (select private.current_role()) = 'admin'
    or (select private.pp_is_operator_for(division))
  );
