-- AXIVA CRM - central de conversas WhatsApp
-- Desenvolvimento isolado: não aplicar diretamente em produção sem validação.

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  whatsapp_number_id uuid not null references public.whatsapp_numbers(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  provider text not null check (provider in ('evolution','meta')),
  contact_phone text not null,
  contact_name text null,
  provider_conversation_ref text null,
  status text not null default 'open' check (status in ('open','archived')),
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz null,
  last_message_preview text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, whatsapp_number_id, contact_phone)
);

create index if not exists whatsapp_conversations_org_last_message_idx
  on public.whatsapp_conversations (organization_id, last_message_at desc nulls last);

create index if not exists whatsapp_conversations_lead_idx
  on public.whatsapp_conversations (organization_id, lead_id)
  where lead_id is not null;

alter table public.whatsapp_conversations enable row level security;

drop policy if exists whatsapp_conversations_member_select on public.whatsapp_conversations;
create policy whatsapp_conversations_member_select
on public.whatsapp_conversations
for select
to authenticated
using (private.is_active_org_member(organization_id));

drop policy if exists whatsapp_conversations_system_admin_all on public.whatsapp_conversations;
create policy whatsapp_conversations_system_admin_all
on public.whatsapp_conversations
for all
to authenticated
using (private.is_system_admin())
with check (private.is_system_admin());

create table if not exists public.whatsapp_messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  whatsapp_number_id uuid not null references public.whatsapp_numbers(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  provider text not null check (provider in ('evolution','meta')),
  provider_message_id text not null,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  text_body text null,
  media_metadata jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'received',
  is_automatic boolean not null default false,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, provider_message_id)
);

create index if not exists whatsapp_messages_conversation_time_idx
  on public.whatsapp_messages (conversation_id, occurred_at desc);

create index if not exists whatsapp_messages_org_time_idx
  on public.whatsapp_messages (organization_id, occurred_at desc);

alter table public.whatsapp_messages enable row level security;

drop policy if exists whatsapp_messages_member_select on public.whatsapp_messages;
create policy whatsapp_messages_member_select
on public.whatsapp_messages
for select
to authenticated
using (private.is_active_org_member(organization_id));

drop policy if exists whatsapp_messages_system_admin_all on public.whatsapp_messages;
create policy whatsapp_messages_system_admin_all
on public.whatsapp_messages
for all
to authenticated
using (private.is_system_admin())
with check (private.is_system_admin());

-- As escritas normais ficam concentradas nas Edge Functions/backend.
-- Usuários autenticados recebem SELECT somente via RLS.
