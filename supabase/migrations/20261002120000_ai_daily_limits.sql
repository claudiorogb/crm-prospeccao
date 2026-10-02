-- Limites diários da AXIVA IA por empresa e por usuário.
-- Mantém a configuração atual como limite padrão por usuário da organização.

alter table public.ai_organization_settings
  add column if not exists daily_request_limit integer not null default 1000;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_organization_settings_daily_request_limit_check'
      and conrelid = 'public.ai_organization_settings'::regclass
  ) then
    alter table public.ai_organization_settings
      add constraint ai_organization_settings_daily_request_limit_check
      check (daily_request_limit between 1 and 100000);
  end if;
end $$;

create table if not exists public.ai_user_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_message_limit integer not null check (daily_message_limit between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.ai_user_settings enable row level security;
revoke all on table public.ai_user_settings from anon, authenticated;
grant select, insert, update, delete on table public.ai_user_settings to service_role;

comment on column public.ai_organization_settings.daily_request_limit is
  'Limite total de perguntas da empresa por dia, somando todos os usuários.';
comment on column public.ai_organization_settings.daily_message_limit is
  'Limite diário padrão por usuário, aplicado quando não existe uma substituição individual.';
comment on table public.ai_user_settings is
  'Limite diário individual da AXIVA IA por usuário e organização; acesso exclusivo ao backend service_role.';
