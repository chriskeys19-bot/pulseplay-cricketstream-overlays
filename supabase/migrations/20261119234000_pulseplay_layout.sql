-- Per-ground layout and an optional per-logo scale.
-- Null layout means the shipped Pro and Mini sizes. RLS is unchanged:
-- anonymous read, admin write.

alter table public.pp_grounds
  add column if not exists layout jsonb;

alter table public.pp_grounds
  drop constraint if exists pp_grounds_layout_object;

alter table public.pp_grounds
  add constraint pp_grounds_layout_object
  check (layout is null or jsonb_typeof(layout) = 'object');

alter table public.pp_assets
  add column if not exists logo_scale numeric;

alter table public.pp_assets
  drop constraint if exists pp_assets_logo_scale_check;

alter table public.pp_assets
  add constraint pp_assets_logo_scale_check
  check (
    logo_scale is null
    or (kind = 'logo' and logo_scale >= 0.25 and logo_scale <= 2)
  );
