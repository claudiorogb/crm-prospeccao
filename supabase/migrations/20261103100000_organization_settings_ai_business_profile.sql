alter table public.organization_settings
  add column if not exists ai_business_profile text;

alter table public.organization_settings
  drop constraint if exists organization_settings_ai_business_profile_len;
alter table public.organization_settings
  add constraint organization_settings_ai_business_profile_len
  check (ai_business_profile is null or char_length(ai_business_profile) <= 2000);

comment on column public.organization_settings.ai_business_profile is
  'Texto configurável pela empresa para a IA de resposta do WhatsApp: o que vende, tom de voz e o que não prometer. Máx. 2000 caracteres.';
