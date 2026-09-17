-- V99: confirmação obrigatória e auditável antes de campanhas comerciais
-- Escopo restrito ao fluxo de e-mail marketing.

alter table public.email_campaigns
  add column if not exists commercial_consent_confirmed_at timestamptz,
  add column if not exists commercial_consent_confirmed_by uuid,
  add column if not exists commercial_consent_statement_version text;

create table if not exists public.email_campaign_compliance_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  statement_version text not null,
  recipient_count integer not null check (recipient_count > 0)
);

create index if not exists idx_email_campaign_compliance_org_campaign
  on public.email_campaign_compliance_confirmations (organization_id, campaign_id, confirmed_at desc);

alter table public.email_campaign_compliance_confirmations enable row level security;

revoke all on public.email_campaign_compliance_confirmations from anon, authenticated;
grant select on public.email_campaign_compliance_confirmations to authenticated;

drop policy if exists email_campaign_compliance_confirmations_select on public.email_campaign_compliance_confirmations;
create policy email_campaign_compliance_confirmations_select
on public.email_campaign_compliance_confirmations
for select
to authenticated
using (
  private.is_active_org_member(organization_id)
  or private.is_system_admin()
);

create or replace function public.confirm_email_campaign_compliance(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_org uuid;
  v_status text;
  v_is_sandbox boolean;
  v_user uuid := auth.uid();
  v_count integer;
  v_statement_version constant text := 'commercial_email_consent_v1';
begin
  if v_user is null then
    raise exception 'Usuário autenticado é obrigatório.' using errcode='42501';
  end if;

  select organization_id, status
    into v_org, v_status
    from public.email_campaigns
   where id = p_campaign_id
   for update;

  if v_org is null then
    raise exception 'Campanha não encontrada.';
  end if;

  if v_status <> 'draft' then
    raise exception 'A confirmação só pode ser registrada enquanto a campanha estiver em rascunho.';
  end if;

  select is_sandbox into v_is_sandbox
    from public.organizations
   where id = v_org;

  if not (
    private.is_active_org_member(v_org)
    or (private.is_system_admin() and coalesce(v_is_sandbox, false))
  ) then
    raise exception 'Sem permissão.' using errcode='42501';
  end if;

  select count(*) into v_count
    from public.email_campaign_recipients
   where campaign_id = p_campaign_id
     and status in ('draft', 'failed');

  if v_count = 0 then
    raise exception 'Selecione e salve pelo menos um destinatário antes de confirmar.';
  end if;

  update public.email_campaigns
     set commercial_consent_confirmed_at = now(),
         commercial_consent_confirmed_by = v_user,
         commercial_consent_statement_version = v_statement_version,
         updated_at = now()
   where id = p_campaign_id;

  insert into public.email_campaign_compliance_confirmations (
    organization_id, campaign_id, confirmed_by, statement_version, recipient_count
  ) values (
    v_org, p_campaign_id, v_user, v_statement_version, v_count
  );

  return true;
end;
$function$;

revoke all on function public.confirm_email_campaign_compliance(uuid) from public;
grant execute on function public.confirm_email_campaign_compliance(uuid) to authenticated;

create or replace function public.invalidate_email_campaign_compliance_on_recipient_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  update public.email_campaigns
     set commercial_consent_confirmed_at = null,
         commercial_consent_confirmed_by = null,
         commercial_consent_statement_version = null,
         updated_at = now()
   where id = coalesce(new.campaign_id, old.campaign_id)
     and status = 'draft';
  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_email_recipient_invalidates_compliance on public.email_campaign_recipients;
create trigger trg_email_recipient_invalidates_compliance
after insert or delete on public.email_campaign_recipients
for each row execute function public.invalidate_email_campaign_compliance_on_recipient_change();

create or replace function public.require_email_campaign_compliance_before_queue()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.status = 'queued' and old.status is distinct from 'queued' then
    if new.commercial_consent_confirmed_at is null
       or new.commercial_consent_confirmed_by is null
       or new.commercial_consent_statement_version <> 'commercial_email_consent_v1' then
      raise exception 'Confirme que os destinatários autorizaram o recebimento de comunicações comerciais antes de iniciar o envio.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_email_campaign_requires_compliance on public.email_campaigns;
create trigger trg_email_campaign_requires_compliance
before update of status on public.email_campaigns
for each row execute function public.require_email_campaign_compliance_before_queue();
