-- Allow the Ground controls poll interval to run from 2 seconds to 5 minutes.
-- The previous check capped poll_ms at 30000.
alter table public.pp_settings drop constraint pp_settings_poll_ms_check;

alter table public.pp_settings
  add constraint pp_settings_poll_ms_check
  check (poll_ms between 2000 and 300000);
