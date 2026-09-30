-- AXIVA CRM - Central de Conversas WhatsApp
-- Arquitetura paralela ao fluxo existente de "Enviar mensagens".
-- A central recebe Meta Cloud API e Evolution sem alterar a fila de campanhas.

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
  last_inbound_at timestamptz null,
  last_outbound_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, whatsapp_number_id, contact_phone)
);

create index if not exists whatsapp_conversations_org_last_message_idx
  on public.whatsapp_conversations (organization_id, last_message_at desc nulls last);

create index if not exists whatsapp_conversations_lead_idx
  on public.whatsapp_conversations (organization_id, lead_id)
  where lead_id is not null;

create index if not exists whatsapp_conversations_contact_phone_idx
  on public.whatsapp_conversations (organization_id, contact_phone);

alter table public.whatsapp_conversations enable row level security;

drop policy if exists whatsapp_conversations_member_select on public.whatsapp_conversations;
create policy whatsapp_conversations_member_select
on public.whatsapp_conversations
for select
to authenticated
using (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

revoke all on table public.whatsapp_conversations from anon;
revoke all on table public.whatsapp_conversations from authenticated;
grant select on table public.whatsapp_conversations to authenticated;
grant all on table public.whatsapp_conversations to service_role;

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
using (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

revoke all on table public.whatsapp_messages from anon;
revoke all on table public.whatsapp_messages from authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant all on table public.whatsapp_messages to service_role;
grant usage, select on sequence public.whatsapp_messages_id_seq to service_role;

-- Tokens por cliente ficam criptografados no Supabase Vault.
-- Estas funções são exclusivas do backend (service_role).
create or replace function public.store_whatsapp_provider_secret(
  p_number_id uuid,
  p_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_ref text;
  v_secret_id uuid;
  v_secret_name text;
begin
  if p_number_id is null then
    raise exception 'number_id is required';
  end if;

  if p_secret is null or char_length(btrim(p_secret)) < 10 then
    raise exception 'invalid provider secret';
  end if;

  select credential_secret_ref
    into v_existing_ref
  from public.whatsapp_numbers
  where id = p_number_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'WhatsApp number not found';
  end if;

  v_secret_name := 'axiva_whatsapp_provider_' || p_number_id::text;

  if v_existing_ref is not null
     and v_existing_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and exists (select 1 from vault.secrets where id = v_existing_ref::uuid) then
    v_secret_id := v_existing_ref::uuid;
    perform vault.update_secret(
      v_secret_id,
      p_secret,
      v_secret_name,
      'AXIVA CRM WhatsApp provider credential'
    );
  else
    v_secret_id := vault.create_secret(
      p_secret,
      v_secret_name,
      'AXIVA CRM WhatsApp provider credential'
    );
  end if;

  update public.whatsapp_numbers
  set credential_secret_ref = v_secret_id::text,
      credential_configured = true,
      updated_at = now()
  where id = p_number_id;

  return v_secret_id::text;
end;
$$;

create or replace function public.read_whatsapp_provider_secret(
  p_number_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select ds.decrypted_secret
    into v_secret
  from public.whatsapp_numbers n
  join vault.decrypted_secrets ds
    on ds.id = n.credential_secret_ref::uuid
  where n.id = p_number_id
    and n.deleted_at is null
    and n.credential_configured = true
    and n.credential_secret_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  limit 1;

  return v_secret;
end;
$$;

revoke all on function public.store_whatsapp_provider_secret(uuid,text) from public, anon, authenticated;
revoke all on function public.read_whatsapp_provider_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_whatsapp_provider_secret(uuid,text) to service_role;
grant execute on function public.read_whatsapp_provider_secret(uuid) to service_role;

-- O webhook Evolution existente continua sendo a fonte da verdade para entrada.
-- Este gatilho apenas projeta cada entrada para a nova Central de Conversas.
create or replace function private.sync_whatsapp_inbound_to_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_conversation_id uuid;
  v_contact_name text;
  v_preview text;
begin
  if new.whatsapp_number_id is null then
    return new;
  end if;

  select case
           when provider in ('evolution','meta') then provider
           else 'evolution'
         end
    into v_provider
  from public.whatsapp_numbers
  where id = new.whatsapp_number_id
    and organization_id = new.organization_id
    and deleted_at is null;

  if v_provider is null then
    return new;
  end if;

  if new.lead_id is not null then
    select nullif(btrim(coalesce(contact_name, business_name)), '')
      into v_contact_name
    from public.leads
    where id = new.lead_id
      and organization_id = new.organization_id;
  end if;

  v_preview := left(
    coalesce(nullif(btrim(new.message_text), ''), 'Mídia recebida'),
    240
  );

  insert into public.whatsapp_conversations (
    organization_id,
    whatsapp_number_id,
    lead_id,
    provider,
    contact_phone,
    contact_name,
    status,
    unread_count,
    last_message_at,
    last_message_preview,
    last_inbound_at,
    created_at,
    updated_at
  )
  values (
    new.organization_id,
    new.whatsapp_number_id,
    new.lead_id,
    v_provider,
    new.sender_phone,
    v_contact_name,
    'open',
    1,
    new.received_at,
    v_preview,
    new.received_at,
    now(),
    now()
  )
  on conflict (organization_id, whatsapp_number_id, contact_phone)
  do update set
    lead_id = coalesce(excluded.lead_id, public.whatsapp_conversations.lead_id),
    contact_name = coalesce(excluded.contact_name, public.whatsapp_conversations.contact_name),
    provider = excluded.provider,
    status = 'open',
    unread_count = public.whatsapp_conversations.unread_count + 1,
    last_message_at = excluded.last_message_at,
    last_message_preview = excluded.last_message_preview,
    last_inbound_at = excluded.last_inbound_at,
    updated_at = now()
  returning id into v_conversation_id;

  insert into public.whatsapp_messages (
    organization_id,
    conversation_id,
    whatsapp_number_id,
    lead_id,
    provider,
    provider_message_id,
    direction,
    message_type,
    text_body,
    media_metadata,
    delivery_status,
    is_automatic,
    occurred_at
  )
  values (
    new.organization_id,
    v_conversation_id,
    new.whatsapp_number_id,
    new.lead_id,
    v_provider,
    new.provider_message_id,
    'inbound',
    case when new.message_text is null or btrim(new.message_text) = '' then 'unknown' else 'text' end,
    new.message_text,
    '{}'::jsonb,
    'received',
    new.classification = 'automatic',
    new.received_at
  )
  on conflict (organization_id, provider, provider_message_id) do nothing;

  return new;
end;
$$;

revoke all on function private.sync_whatsapp_inbound_to_conversation() from public, anon, authenticated;

drop trigger if exists trg_whatsapp_inbound_to_conversation
  on public.whatsapp_inbound_events;

create trigger trg_whatsapp_inbound_to_conversation
after insert on public.whatsapp_inbound_events
for each row
execute function private.sync_whatsapp_inbound_to_conversation();

-- Backfill dos eventos já existentes, sem alterar lead, funil ou histórico atual.
insert into public.whatsapp_conversations (
  organization_id,
  whatsapp_number_id,
  lead_id,
  provider,
  contact_phone,
  contact_name,
  status,
  unread_count,
  last_message_at,
  last_message_preview,
  last_inbound_at,
  created_at,
  updated_at
)
select
  e.organization_id,
  e.whatsapp_number_id,
  (array_agg(e.lead_id order by e.received_at desc) filter (where e.lead_id is not null))[1],
  case when n.provider in ('evolution','meta') then n.provider else 'evolution' end,
  e.sender_phone,
  max(coalesce(l.contact_name, l.business_name)) filter (where l.id is not null),
  'open',
  count(*)::integer,
  max(e.received_at),
  (array_agg(left(coalesce(nullif(btrim(e.message_text), ''), 'Mídia recebida'), 240) order by e.received_at desc))[1],
  max(e.received_at),
  min(e.created_at),
  now()
from public.whatsapp_inbound_events e
join public.whatsapp_numbers n
  on n.id = e.whatsapp_number_id
 and n.organization_id = e.organization_id
 and n.deleted_at is null
left join public.leads l
  on l.id = e.lead_id
 and l.organization_id = e.organization_id
where e.whatsapp_number_id is not null
group by
  e.organization_id,
  e.whatsapp_number_id,
  case when n.provider in ('evolution','meta') then n.provider else 'evolution' end,
  e.sender_phone
on conflict (organization_id, whatsapp_number_id, contact_phone)
do update set
  lead_id = coalesce(excluded.lead_id, public.whatsapp_conversations.lead_id),
  contact_name = coalesce(excluded.contact_name, public.whatsapp_conversations.contact_name),
  provider = excluded.provider,
  last_message_at = greatest(public.whatsapp_conversations.last_message_at, excluded.last_message_at),
  last_inbound_at = greatest(public.whatsapp_conversations.last_inbound_at, excluded.last_inbound_at),
  updated_at = now();

insert into public.whatsapp_messages (
  organization_id,
  conversation_id,
  whatsapp_number_id,
  lead_id,
  provider,
  provider_message_id,
  direction,
  message_type,
  text_body,
  media_metadata,
  delivery_status,
  is_automatic,
  occurred_at,
  created_at
)
select
  e.organization_id,
  c.id,
  e.whatsapp_number_id,
  e.lead_id,
  c.provider,
  e.provider_message_id,
  'inbound',
  case when e.message_text is null or btrim(e.message_text) = '' then 'unknown' else 'text' end,
  e.message_text,
  '{}'::jsonb,
  'received',
  e.classification = 'automatic',
  e.received_at,
  e.created_at
from public.whatsapp_inbound_events e
join public.whatsapp_conversations c
  on c.organization_id = e.organization_id
 and c.whatsapp_number_id = e.whatsapp_number_id
 and c.contact_phone = e.sender_phone
where e.whatsapp_number_id is not null
on conflict (organization_id, provider, provider_message_id) do nothing;
