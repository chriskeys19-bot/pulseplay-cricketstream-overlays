-- Named score URLs for grounds that host more than one game.
-- score_url stays the overlay that is on air. score_overlays is the
-- saved list; the entry with active true matches score_url.
-- This does not change mode, active_ad_id, or updated_at.
-- RLS is unchanged: the column lives on pp_grounds.

alter table public.pp_grounds
  add column if not exists score_overlays jsonb not null default '[]'::jsonb;

update public.pp_grounds
set score_overlays = jsonb_build_array(
  jsonb_build_object(
    'id', id || '-game-1',
    'name', 'Game 1',
    'url', score_url,
    'active', true
  )
)
where score_overlays = '[]'::jsonb
  and score_url is not null
  and btrim(score_url) <> '';
