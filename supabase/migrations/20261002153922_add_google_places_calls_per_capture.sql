alter table public.organization_settings
  add column if not exists google_places_calls_per_capture integer not null default 2;

update public.organization_settings
set google_places_calls_per_capture = 2
where google_places_calls_per_capture is null;

alter table public.organization_settings
  drop constraint if exists organization_settings_google_places_calls_per_capture_check;

alter table public.organization_settings
  add constraint organization_settings_google_places_calls_per_capture_check
  check (google_places_calls_per_capture between 1 and 20);