-- Optional scorecard link on a stream card. Tournament short names stay on
-- event (AMLCA, PSD, NYCT, NCCA) and the id prefix, so no tournament column.

alter table public.pp_streams
  add column if not exists scorecard_url text;

comment on column public.pp_streams.scorecard_url is
  'Public scorecard URL. Empty means the Streams card shows no scorecard link.';
