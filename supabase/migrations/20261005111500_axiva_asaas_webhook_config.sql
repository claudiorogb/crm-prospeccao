create table if not exists public.axiva_asaas_config (
  id integer primary key default 1 check (id = 1),
  webhook_id text,
  webhook_token text not null default ('whsec_' || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.axiva_asaas_config enable row level security;
revoke all on public.axiva_asaas_config from anon, authenticated, public;

insert into public.axiva_asaas_config (id)
values (1)
on conflict (id) do nothing;
