create table if not exists public.axiva_paid_contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  plan_id text not null references public.crm_plans(id),
  contract_version text not null,
  signer_name text not null,
  signer_email text not null,
  cnpj text,
  accepted_at timestamptz not null default now(),
  user_agent text,
  checkout_id text,
  asaas_customer_id text,
  asaas_subscription_id text,
  status text not null default 'accepted' check (status in ('accepted','paid','cancelled','expired')),
  contract_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists axiva_paid_contract_org_idx on public.axiva_paid_contract_acceptances(organization_id, created_at desc);
create index if not exists axiva_paid_contract_checkout_idx on public.axiva_paid_contract_acceptances(checkout_id);
create index if not exists axiva_paid_contract_subscription_idx on public.axiva_paid_contract_acceptances(asaas_subscription_id);

alter table public.axiva_paid_contract_acceptances enable row level security;
revoke all on public.axiva_paid_contract_acceptances from anon, authenticated, public;

create table if not exists public.axiva_asaas_webhook_events (
  id text primary key,
  event text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.axiva_asaas_webhook_events enable row level security;
revoke all on public.axiva_asaas_webhook_events from anon, authenticated, public;

create or replace function public.accept_axiva_paid_contract(
  p_plan_id text,
  p_contract_version text,
  p_signer_name text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_cnpj text;
  v_email text;
  v_id uuid;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if p_plan_id not in ('axiva','axiva_plus','axiva_max') then raise exception 'Plano inválido'; end if;
  if coalesce(trim(p_signer_name),'') = '' then raise exception 'Nome do contratante obrigatório'; end if;
  if coalesce(trim(p_contract_version),'') = '' then raise exception 'Versão do contrato obrigatória'; end if;

  select om.organization_id into v_org
  from public.organization_members om
  where om.user_id = v_user and om.is_active = true and om.deleted_at is null
  order by om.created_at
  limit 1;

  if v_org is null then raise exception 'Organização não encontrada'; end if;

  select o.cnpj into v_cnpj from public.organizations o
  where o.id = v_org and o.is_active = true and o.deleted_at is null;

  select u.email into v_email from auth.users u where u.id = v_user;

  insert into public.axiva_paid_contract_acceptances
    (organization_id,user_id,plan_id,contract_version,signer_name,signer_email,cnpj,accepted_at,user_agent,status)
  values
    (v_org,v_user,p_plan_id,trim(p_contract_version),trim(p_signer_name),coalesce(v_email,''),v_cnpj,now(),left(coalesce(p_user_agent,''),1000),'accepted')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.accept_axiva_paid_contract(text,text,text,text) from public, anon;
grant execute on function public.accept_axiva_paid_contract(text,text,text,text) to authenticated;
