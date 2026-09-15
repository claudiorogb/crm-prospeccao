-- V76: fundacao segura e multiempresa para integracoes externas.
-- Nenhum conector e ativado por esta migracao e nenhuma credencial e armazenada
-- nas tabelas expostas pela Data API.

-- Corrige permissoes legadas identificadas pelo Security Advisor. As funcoes
-- continuam disponiveis para usuarios autenticados e validam a organizacao no corpo.
revoke execute on function public.get_origin_conversion(uuid) from public, anon;
revoke execute on function public.get_sales_page(uuid, date, date) from public, anon;
revoke execute on function public.get_seller_performance(uuid) from public, anon;
revoke execute on function public.save_lead_journey_checkpoint(
  uuid, uuid, text, text, numeric, date, numeric, date, numeric, date, text
) from public, anon;

grant execute on function public.get_origin_conversion(uuid) to authenticated;
grant execute on function public.get_sales_page(uuid, date, date) to authenticated;
grant execute on function public.get_seller_performance(uuid) to authenticated;
grant execute on function public.save_lead_journey_checkpoint(
  uuid, uuid, text, text, numeric, date, numeric, date, numeric, date, text
) to authenticated;

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null default 'erp'
    check (category in ('erp', 'ecommerce', 'finance', 'invoicing', 'custom')),
  provider_key text not null
    check (provider_key ~ '^[a-z0-9][a-z0-9_-]{1,49}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 2 and 80),
  sync_direction text not null default 'outbound'
    check (sync_direction in ('outbound', 'inbound', 'bidirectional')),
  status text not null default 'draft'
    check (status in ('draft', 'inactive', 'active', 'error', 'revoked')),
  api_version text,
  enabled_events text[] not null default array[
    'sale.created', 'sale.updated', 'sale.archived'
  ]::text[],
  credentials_configured boolean not null default false,
  external_account_id text,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_summary text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  constraint integration_connections_error_summary_size
    check (last_error_summary is null or char_length(last_error_summary) <= 500),
  constraint integration_connections_deleted_consistency
    check (deleted_at is null or status = 'revoked')
);

create unique index integration_connections_org_provider_name_unique
  on public.integration_connections (
    organization_id,
    provider_key,
    lower(btrim(display_name))
  )
  where deleted_at is null;

create index integration_connections_org_status_idx
  on public.integration_connections (organization_id, status)
  where deleted_at is null;

create table public.integration_external_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete restrict,
  entity_type text not null
    check (entity_type in ('lead', 'customer', 'sale', 'activity', 'campaign')),
  crm_entity_id uuid not null,
  external_entity_id text not null
    check (char_length(btrim(external_entity_id)) between 1 and 255),
  external_version text,
  remote_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index integration_external_links_crm_unique
  on public.integration_external_links (connection_id, entity_type, crm_entity_id);

create unique index integration_external_links_external_unique
  on public.integration_external_links (connection_id, entity_type, external_entity_id);

create index integration_external_links_org_idx
  on public.integration_external_links (organization_id, entity_type, crm_entity_id);

create table public.integration_outbox (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete restrict,
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  event_version smallint not null default 1 check (event_version > 0),
  aggregate_type text not null
    check (aggregate_type in ('lead', 'customer', 'sale', 'activity', 'campaign')),
  aggregate_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_outbox_idempotency_unique unique (connection_id, idempotency_key),
  constraint integration_outbox_error_summary_size
    check (last_error_summary is null or char_length(last_error_summary) <= 500)
);

create index integration_outbox_pending_idx
  on public.integration_outbox (status, coalesce(next_attempt_at, available_at), created_at)
  where status in ('pending', 'failed');

create index integration_outbox_org_created_idx
  on public.integration_outbox (organization_id, created_at desc);

create table public.integration_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete restrict,
  external_event_id text not null
    check (char_length(btrim(external_event_id)) between 1 and 255),
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  payload jsonb not null,
  payload_hash text not null
    check (payload_hash ~ '^[a-f0-9]{64}$'),
  signature_verified boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'rejected', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_inbox_event_unique unique (connection_id, external_event_id),
  constraint integration_inbox_verified_before_processing
    check (status in ('received', 'rejected') or signature_verified = true),
  constraint integration_inbox_error_summary_size
    check (last_error_summary is null or char_length(last_error_summary) <= 500)
);

create index integration_inbox_org_received_idx
  on public.integration_inbox (organization_id, received_at desc);

create or replace function private.guard_integration_connection()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.provider_key := lower(btrim(new.provider_key));
  new.display_name := regexp_replace(btrim(new.display_name), '\s+', ' ', 'g');
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());

    -- Chamadas autenticadas so podem preparar uma conexao. Credenciais e
    -- ativacao pertencem exclusivamente ao backend confiavel.
    if auth.uid() is not null then
      new.status := 'draft';
      new.credentials_configured := false;
      new.external_account_id := null;
      new.last_sync_at := null;
      new.last_success_at := null;
      new.last_error_code := null;
      new.last_error_summary := null;
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'A organizacao da integracao nao pode ser alterada.' using errcode = '42501';
    end if;

    if auth.uid() is not null then
      if new.status not in ('draft', 'inactive') then
        raise exception 'A ativacao da integracao deve ser concluida pelo servidor.' using errcode = '42501';
      end if;

      if new.credentials_configured is distinct from old.credentials_configured
        or new.external_account_id is distinct from old.external_account_id
        or new.last_sync_at is distinct from old.last_sync_at
        or new.last_success_at is distinct from old.last_success_at
        or new.last_error_code is distinct from old.last_error_code
        or new.last_error_summary is distinct from old.last_error_summary then
        raise exception 'Campos operacionais da integracao sao controlados pelo servidor.' using errcode = '42501';
      end if;
    end if;

    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;

  return new;
end;
$$;

revoke all on function private.guard_integration_connection() from public;

create trigger trg_guard_integration_connection
before insert or update on public.integration_connections
for each row execute function private.guard_integration_connection();

create or replace function private.validate_integration_external_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_connection_org uuid;
  v_entity_exists boolean := false;
begin
  select c.organization_id
    into v_connection_org
  from public.integration_connections c
  where c.id = new.connection_id
    and c.deleted_at is null;

  if v_connection_org is null or v_connection_org <> new.organization_id then
    raise exception 'Integracao e registro precisam pertencer a mesma organizacao.' using errcode = '23514';
  end if;

  if new.entity_type in ('lead', 'customer') then
    select exists (
      select 1 from public.leads l
      where l.id = new.crm_entity_id and l.organization_id = new.organization_id
    ) into v_entity_exists;
  elsif new.entity_type = 'sale' then
    select exists (
      select 1 from public.sales s
      where s.id = new.crm_entity_id and s.organization_id = new.organization_id
    ) into v_entity_exists;
  elsif new.entity_type = 'activity' then
    select exists (
      select 1 from public.activities a
      where a.id = new.crm_entity_id and a.organization_id = new.organization_id
    ) into v_entity_exists;
  elsif new.entity_type = 'campaign' then
    select exists (
      select 1 from public.campaigns c
      where c.id = new.crm_entity_id and c.organization_id = new.organization_id
    ) into v_entity_exists;
  end if;

  if not v_entity_exists then
    raise exception 'Registro do CRM nao encontrado na organizacao informada.' using errcode = '23514';
  end if;

  new.external_entity_id := btrim(new.external_entity_id);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.validate_integration_external_link() from public;

create trigger trg_validate_integration_external_link
before insert or update on public.integration_external_links
for each row execute function private.validate_integration_external_link();

create or replace function private.enqueue_sale_integration_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_connection record;
  v_event_id uuid;
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'sale.created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_event_type := 'sale.archived';
  elsif row(
    old.sale_date, old.amount, old.product_service, old.lead_id, old.origin
  ) is distinct from row(
    new.sale_date, new.amount, new.product_service, new.lead_id, new.origin
  ) then
    v_event_type := 'sale.updated';
  else
    return new;
  end if;

  for v_connection in
    select c.id
    from public.integration_connections c
    where c.organization_id = new.organization_id
      and c.category = 'erp'
      and c.status = 'active'
      and c.credentials_configured = true
      and c.deleted_at is null
      and c.sync_direction in ('outbound', 'bidirectional')
      and v_event_type = any(c.enabled_events)
  loop
    v_event_id := gen_random_uuid();

    insert into public.integration_outbox (
      id,
      organization_id,
      connection_id,
      event_type,
      aggregate_type,
      aggregate_id,
      idempotency_key,
      payload
    ) values (
      v_event_id,
      new.organization_id,
      v_connection.id,
      v_event_type,
      'sale',
      new.id,
      v_event_id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'schema_version', 1,
        'sale_id', new.id,
        'lead_id', new.lead_id,
        'sale_date', new.sale_date,
        'amount', new.amount,
        'currency', 'BRL',
        'product_service', new.product_service,
        'origin', new.origin,
        'updated_at', new.updated_at
      ))
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.enqueue_sale_integration_event() from public;

create trigger trg_enqueue_sale_integration_event
after insert or update on public.sales
for each row execute function private.enqueue_sale_integration_event();

create trigger audit_change
after insert or update or delete on public.integration_connections
for each row execute function public.audit_admin_change();

alter table public.integration_connections enable row level security;
alter table public.integration_external_links enable row level security;
alter table public.integration_outbox enable row level security;
alter table public.integration_inbox enable row level security;

create policy integration_connections_admin_select
on public.integration_connections for select
to authenticated
using (
  (select private.is_system_admin())
  or (select private.has_org_role(organization_id, array['owner', 'admin']))
);

create policy integration_connections_admin_insert
on public.integration_connections for insert
to authenticated
with check (
  (select private.is_system_admin())
  or (select private.has_org_role(organization_id, array['owner', 'admin']))
);

create policy integration_connections_admin_update
on public.integration_connections for update
to authenticated
using (
  (select private.is_system_admin())
  or (select private.has_org_role(organization_id, array['owner', 'admin']))
)
with check (
  (select private.is_system_admin())
  or (select private.has_org_role(organization_id, array['owner', 'admin']))
);

create policy integration_external_links_admin_select
on public.integration_external_links for select
to authenticated
using (
  (select private.is_system_admin())
  or (select private.has_org_role(organization_id, array['owner', 'admin']))
);

create policy integration_outbox_admin_select
on public.integration_outbox for select
to authenticated
using (
  (select private.is_system_admin())
  or (select private.has_org_role(organization_id, array['owner', 'admin']))
);

-- O inbox pode conter o corpo bruto recebido de terceiros. Mesmo administradores
-- de empresas nao o consultam diretamente pela interface.
create policy integration_inbox_system_admin_select
on public.integration_inbox for select
to authenticated
using ((select private.is_system_admin()));

revoke all on table public.integration_connections from anon, authenticated;
revoke all on table public.integration_external_links from anon, authenticated;
revoke all on table public.integration_outbox from anon, authenticated;
revoke all on table public.integration_inbox from anon, authenticated;

grant select, insert, update on table public.integration_connections to authenticated;
grant select on table public.integration_external_links to authenticated;
grant select on table public.integration_outbox to authenticated;
grant select on table public.integration_inbox to authenticated;

grant all on table public.integration_connections to service_role;
grant all on table public.integration_external_links to service_role;
grant all on table public.integration_outbox to service_role;
grant all on table public.integration_inbox to service_role;

comment on table public.integration_connections is
  'Metadados nao sigilosos das conexoes externas. Credenciais ficam apenas no backend/Vault.';
comment on table public.integration_external_links is
  'Mapeamento idempotente entre registros do AXIVA CRM e IDs de sistemas externos.';
comment on table public.integration_outbox is
  'Fila transacional de eventos de saida. Processamento exclusivo por backend confiavel.';
comment on table public.integration_inbox is
  'Eventos recebidos de terceiros apos validacao criptografica pelo backend.';
