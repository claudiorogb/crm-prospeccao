alter table public.axiva_asaas_config
  add column if not exists sandbox_webhook_id text,
  add column if not exists sandbox_webhook_token text;

update public.axiva_asaas_config
set sandbox_webhook_token = coalesce(sandbox_webhook_token, encode(gen_random_bytes(32), 'hex')),
    updated_at = now()
where id = 1;

alter table public.axiva_billing_accounts
  add column if not exists environment text not null default 'production';

alter table public.axiva_billing_accounts
  drop constraint if exists axiva_billing_accounts_environment_check;

alter table public.axiva_billing_accounts
  add constraint axiva_billing_accounts_environment_check
  check (environment in ('production','sandbox'));
