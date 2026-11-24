-- Pulse Play only. Lets the Live Wall subscribe to pp_streams.
-- Does not touch Cheetahs tables, policies, or functions.
-- The wall polls until this is applied. Apply it separately.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pp_streams'
  ) then
    alter publication supabase_realtime add table public.pp_streams;
  end if;
end $$;
