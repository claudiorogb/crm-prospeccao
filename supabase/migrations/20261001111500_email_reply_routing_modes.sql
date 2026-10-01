-- Reply routing for Resend prospecting.
-- Keeps tenant routing isolated while allowing a neutral platform address
-- or an optional customer-owned reply domain.

alter table public.email_connections
  add column if not exists reply_mode text not null default 'system',
  add column if not exists custom_reply_domain text,
  add column if not exists custom_reply_email text,
  add column if not exists custom_reply_domain_id text,
  add column if not exists custom_reply_status text,
  add column if not exists custom_reply_dns jsonb not null default '[]'::jsonb,
  add column if not exists resend_full_access boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_connections_reply_mode_check'
      and conrelid = 'public.email_connections'::regclass
  ) then
    alter table public.email_connections
      add constraint email_connections_reply_mode_check
      check (reply_mode in ('system','custom'));
  end if;
end $$;

alter table public.email_campaign_recipients
  add column if not exists resend_message_ids text[] not null default '{}'::text[];

create index if not exists email_campaign_recipients_resend_message_ids_gin
  on public.email_campaign_recipients using gin (resend_message_ids);

alter table public.email_platform_config
  add column if not exists generic_reply_address text,
  add column if not exists generic_reply_domain_id text,
  add column if not exists generic_reply_status text,
  add column if not exists generic_reply_dns jsonb not null default '[]'::jsonb;
