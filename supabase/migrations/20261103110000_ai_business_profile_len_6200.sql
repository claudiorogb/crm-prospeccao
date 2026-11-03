alter table public.organization_settings
  drop constraint if exists organization_settings_ai_business_profile_len;
alter table public.organization_settings
  add constraint organization_settings_ai_business_profile_len
  check (ai_business_profile is null or char_length(ai_business_profile) <= 6200);
