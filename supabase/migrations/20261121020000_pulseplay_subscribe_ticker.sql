-- CricketCrazeUSA like-and-subscribe ticker.
-- Global copy and timing live on pp_settings. Each ground can turn the
-- ticker off, and ticker_trigger_at asks that ground's renderer for one
-- immediate pass. This does not change mode, active_ad_id, or updated_at.
-- RLS is unchanged: anonymous read, admin write.

alter table public.pp_settings
  add column if not exists ticker_enabled boolean not null default true;

alter table public.pp_settings
  add column if not exists ticker_interval_seconds integer not null default 600;

alter table public.pp_settings
  drop constraint if exists pp_settings_ticker_interval_seconds_check;

alter table public.pp_settings
  add constraint pp_settings_ticker_interval_seconds_check
  check (ticker_interval_seconds between 60 and 86400);

alter table public.pp_settings
  add column if not exists ticker_duration_seconds integer not null default 20;

alter table public.pp_settings
  drop constraint if exists pp_settings_ticker_duration_seconds_check;

alter table public.pp_settings
  add constraint pp_settings_ticker_duration_seconds_check
  check (ticker_duration_seconds between 5 and 180);

alter table public.pp_settings
  add column if not exists ticker_messages jsonb not null default '[
    "Enjoying the game? Like and subscribe to CricketCrazeUSA for more USA cricket!",
    "Never miss a match. Subscribe to CricketCrazeUSA and tap the bell 🔔",
    "Share this stream with family and friends who couldn''t make it to the ground!"
  ]'::jsonb;

alter table public.pp_grounds
  add column if not exists show_subscribe_ticker boolean not null default true;

alter table public.pp_grounds
  add column if not exists ticker_trigger_at timestamptz;
