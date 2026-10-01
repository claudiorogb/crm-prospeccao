-- AXIVA CRM AI — fundação somente leitura.
-- Esta migration cria apenas estruturas novas e não altera tabelas/regras existentes.

create table if not exists public.ai_organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  daily_message_limit integer not null default 100 check (daily_message_limit between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_org_updated_idx
  on public.ai_conversations (user_id, organization_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  provider text,
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  provider_request_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at);

create index if not exists ai_messages_expiry_idx
  on public.ai_messages (expires_at);

create table if not exists public.ai_request_audit (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  request_id text,
  model text,
  data_scopes text[] not null default '{}',
  records_considered integer not null default 0 check (records_considered >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  success boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);

create index if not exists ai_request_audit_user_created_idx
  on public.ai_request_audit (user_id, created_at desc);

create index if not exists ai_request_audit_org_created_idx
  on public.ai_request_audit (organization_id, created_at desc);

alter table public.ai_organization_settings enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_request_audit enable row level security;

-- Fail closed: nenhum acesso direto pelo navegador.
revoke all on table public.ai_organization_settings from anon, authenticated;
revoke all on table public.ai_conversations from anon, authenticated;
revoke all on table public.ai_messages from anon, authenticated;
revoke all on table public.ai_request_audit from anon, authenticated;

-- A Edge Function usa service_role apenas para as tabelas internas da IA.
grant select, insert, update, delete on table public.ai_organization_settings to service_role;
grant select, insert, update, delete on table public.ai_conversations to service_role;
grant select, insert, update, delete on table public.ai_messages to service_role;
grant select, insert, update, delete on table public.ai_request_audit to service_role;

comment on table public.ai_organization_settings is
  'Backend-only. Opt-in da IA por organização; ausência de linha equivale a desativado.';
comment on table public.ai_conversations is
  'Backend-only. Conversas da IA, sempre vinculadas a usuário e organização.';
comment on table public.ai_messages is
  'Backend-only. Histórico limitado da IA; não armazena contexto bruto recuperado do CRM.';
comment on table public.ai_request_audit is
  'Backend-only. Auditoria de uso da IA sem armazenar os registros comerciais usados como contexto.';
