-- Anonymous renderers cannot update pp_grounds (admin RLS only).
-- This is the one write they are allowed: when a video finishes, set that
-- ground back to Logos + Score. It does nothing for an image ad, and it
-- does nothing if Ground controls has already written a newer updated_at.

create or replace function public.pulseplay_return_to_logos(
  p_ground_id text,
  p_ad_id text,
  p_seen_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update public.pp_grounds as g
  set mode = 'logos_score',
      active_ad_id = null,
      updated_at = now()
  where g.id = p_ground_id
    and g.mode = 'ad'
    and g.active_ad_id = p_ad_id
    and g.updated_at = p_seen_at
    and exists (
      select 1
      from public.pp_assets as a
      where a.id = g.active_ad_id
        and a.kind = 'ad'
        and (
          a.media_type = 'video'
          or (a.media_type is null and a.mime like 'video/%')
        )
    );
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function public.pulseplay_return_to_logos(text, text, timestamptz) from public;
grant execute on function public.pulseplay_return_to_logos(text, text, timestamptz) to anon, authenticated;
