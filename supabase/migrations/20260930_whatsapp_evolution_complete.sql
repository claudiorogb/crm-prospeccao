-- AXIVA CRM - evolução completa da Central WhatsApp (Evolution API)
-- Additivo: preserva campanhas, filas e integrações existentes.

alter table public.whatsapp_conversations
  add column if not exists assigned_to uuid null references public.profiles(id) on delete set null,
  add column if not exists last_read_at timestamptz null;

create index if not exists whatsapp_conversations_assigned_to_idx
  on public.whatsapp_conversations (organization_id, assigned_to)
  where assigned_to is not null;

alter table public.whatsapp_messages
  add column if not exists source text not null default 'provider',
  add column if not exists sent_by_user_id uuid null references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_messages_source_check'
      and conrelid = 'public.whatsapp_messages'::regclass
  ) then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_source_check
      check (source in ('provider','crm','phone'));
  end if;
end $$;

create table if not exists public.whatsapp_quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  body text not null,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint whatsapp_quick_replies_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint whatsapp_quick_replies_body_len check (char_length(btrim(body)) between 1 and 4096)
);

create index if not exists whatsapp_quick_replies_org_active_idx
  on public.whatsapp_quick_replies (organization_id, is_active, name)
  where deleted_at is null;

alter table public.whatsapp_quick_replies enable row level security;

drop policy if exists whatsapp_quick_replies_member_select on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_member_select
on public.whatsapp_quick_replies
for select
to authenticated
using (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

drop policy if exists whatsapp_quick_replies_member_insert on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_member_insert
on public.whatsapp_quick_replies
for insert
to authenticated
with check (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

drop policy if exists whatsapp_quick_replies_member_update on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_member_update
on public.whatsapp_quick_replies
for update
to authenticated
using (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
)
with check (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

drop policy if exists whatsapp_quick_replies_member_delete on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_member_delete
on public.whatsapp_quick_replies
for delete
to authenticated
using (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

revoke all on table public.whatsapp_quick_replies from anon;
grant select, insert, update, delete on table public.whatsapp_quick_replies to authenticated;
grant all on table public.whatsapp_quick_replies to service_role;

create or replace function private.sync_whatsapp_contact_name_from_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.contact_name, new.business_name)), '');

  update public.whatsapp_conversations
     set contact_name = v_name,
         updated_at = now()
   where organization_id = new.organization_id
     and lead_id = new.id
     and contact_name is distinct from v_name;

  return new;
end;
$$;

revoke all on function private.sync_whatsapp_contact_name_from_lead() from public, anon, authenticated;

drop trigger if exists trg_sync_whatsapp_contact_name_from_lead on public.leads;
create trigger trg_sync_whatsapp_contact_name_from_lead
after insert or update of contact_name, business_name
on public.leads
for each row
execute function private.sync_whatsapp_contact_name_from_lead();
