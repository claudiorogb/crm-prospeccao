-- AXIVA CRM billing: one consolidated recurring charge with per-user plans and licenses
create table if not exists public.axiva_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  asaas_customer_id text,
  asaas_subscription_id text,
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled','suspended')),
  current_amount numeric(12,2) not null default 0,
  next_due_date date,
  cancelled_at timestamptz,
  default_plan_id text references public.crm_plans(id),
  licensed_seats integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.axiva_billing_accounts add column if not exists default_plan_id text references public.crm_plans(id);
alter table public.axiva_billing_accounts add column if not exists licensed_seats integer not null default 1;
alter table public.axiva_paid_contract_acceptances add column if not exists license_quantity integer not null default 1;

alter table public.axiva_billing_accounts enable row level security;
drop policy if exists "axiva_billing_accounts_select_member" on public.axiva_billing_accounts;
create policy "axiva_billing_accounts_select_member"
on public.axiva_billing_accounts for select to authenticated
using (exists (
  select 1 from public.organization_members om
  where om.organization_id=axiva_billing_accounts.organization_id
    and om.user_id=(select auth.uid()) and om.is_active=true and om.deleted_at is null
));
revoke all on public.axiva_billing_accounts from anon;
grant select on public.axiva_billing_accounts to authenticated;

create or replace function public.get_my_billing_overview()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid:=auth.uid(); v_org_id uuid; v_role text; v_account jsonb; v_members jsonb;
  v_total numeric(12,2); v_licensed_seats integer:=1; v_default_plan text:='axiva';
  v_assigned_seats integer:=0; v_assigned_total numeric(12,2):=0; v_default_value numeric(12,2):=45;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select om.organization_id,om.role into v_org_id,v_role
  from public.organization_members om join public.organizations o on o.id=om.organization_id
  where om.user_id=v_user_id and om.is_active=true and om.deleted_at is null and o.is_active=true and o.deleted_at is null
  order by case when om.role='owner' then 0 when om.role='admin' then 1 else 2 end limit 1;
  if v_org_id is null then raise exception 'ORGANIZATION_NOT_FOUND'; end if;

  select coalesce(a.licensed_seats,1),coalesce(a.default_plan_id,'axiva') into v_licensed_seats,v_default_plan
  from public.axiva_billing_accounts a where a.organization_id=v_org_id;
  if v_default_plan='axiva_plus' then v_default_value:=79.8;
  elsif v_default_plan='axiva_max' then v_default_value:=164.8; end if;

  select count(*)::integer,coalesce(sum(case when a.plan_id='axiva' then 45 when a.plan_id='axiva_plus' then 79.8 when a.plan_id='axiva_max' then 164.8 else 0 end),0)::numeric(12,2)
  into v_assigned_seats,v_assigned_total
  from public.user_plan_assignments a where a.organization_id=v_org_id and a.status='active' and a.trial_ends_at is null;
  v_total:=v_assigned_total+greatest(0,v_licensed_seats-v_assigned_seats)*v_default_value;

  select to_jsonb(x) into v_account from (
    select id,organization_id,asaas_customer_id,asaas_subscription_id,status,current_amount,next_due_date,cancelled_at,licensed_seats,default_plan_id,updated_at
    from public.axiva_billing_accounts where organization_id=v_org_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.full_name,x.email),'[]'::jsonb) into v_members
  from (
    select om.user_id,om.role,om.display_name as member_display_name,coalesce(pf.full_name,om.display_name,u.email) as full_name,u.email,
      a.plan_id,cp.name as plan_name,cp.price_monthly,a.status as plan_status,a.trial_ends_at
    from public.organization_members om join auth.users u on u.id=om.user_id
    left join public.profiles pf on pf.id=om.user_id
    left join public.user_plan_assignments a on a.organization_id=om.organization_id and a.user_id=om.user_id
    left join public.crm_plans cp on cp.id=a.plan_id
    where om.organization_id=v_org_id and om.is_active=true and om.deleted_at is null
  ) x;

  return jsonb_build_object('organization_id',v_org_id,'role',v_role,'can_manage',v_role in ('owner','admin'),'billing_account',coalesce(v_account,'null'::jsonb),'members',v_members,'total_monthly',v_total);
end;$function$;
revoke all on function public.get_my_billing_overview() from public,anon;
grant execute on function public.get_my_billing_overview() to authenticated;

create or replace function public.accept_axiva_paid_contract_v2(p_plan_id text,p_contract_version text,p_signer_name text,p_user_agent text default null,p_license_quantity integer default 1)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid:=auth.uid(); v_org uuid; v_cnpj text; v_email text; v_id uuid; v_qty integer:=greatest(1,least(coalesce(p_license_quantity,1),100));
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if p_plan_id not in ('axiva','axiva_plus','axiva_max') then raise exception 'Plano inválido'; end if;
  if coalesce(trim(p_signer_name),'')='' then raise exception 'Nome do contratante obrigatório'; end if;
  if coalesce(trim(p_contract_version),'')='' then raise exception 'Versão do contrato obrigatória'; end if;
  select om.organization_id into v_org from public.organization_members om where om.user_id=v_user and om.is_active=true and om.deleted_at is null order by om.created_at limit 1;
  if v_org is null then raise exception 'Organização não encontrada'; end if;
  select o.cnpj into v_cnpj from public.organizations o where o.id=v_org and o.is_active=true and o.deleted_at is null;
  select u.email into v_email from auth.users u where u.id=v_user;
  insert into public.axiva_billing_accounts(organization_id,status,current_amount,default_plan_id,licensed_seats,updated_at)
  values(v_org,'pending',0,p_plan_id,v_qty,now()) on conflict (organization_id) do update set default_plan_id=excluded.default_plan_id,licensed_seats=greatest(public.axiva_billing_accounts.licensed_seats,excluded.licensed_seats),status=case when public.axiva_billing_accounts.status='cancelled' then 'pending' else public.axiva_billing_accounts.status end,updated_at=now();
  insert into public.axiva_paid_contract_acceptances(organization_id,user_id,plan_id,contract_version,signer_name,signer_email,cnpj,accepted_at,user_agent,status,license_quantity)
  values(v_org,v_user,p_plan_id,p_contract_version,trim(p_signer_name),coalesce(v_email,''),v_cnpj,now(),left(coalesce(p_user_agent,''),1000),'accepted',v_qty) returning id into v_id;
  return v_id;
end;$function$;
revoke all on function public.accept_axiva_paid_contract_v2(text,text,text,text,integer) from public,anon;
grant execute on function public.accept_axiva_paid_contract_v2(text,text,text,text,integer) to authenticated;

create or replace function public.prepare_axiva_paid_contract_v2(p_cnpj text,p_organization_name text,p_plan_id text,p_contract_version text,p_signer_name text,p_user_agent text default null,p_license_quantity integer default 1)
returns table(organization_id uuid,contract_id uuid,plan_id text) language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid:=auth.uid(); v_cnpj text:=public.normalize_cnpj(p_cnpj); v_org_id uuid; v_contract_id uuid; v_email text; v_existing_org uuid; v_qty integer:=greatest(1,least(coalesce(p_license_quantity,1),100));
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_cnpj is null or length(v_cnpj)<>14 then raise exception 'INVALID_CNPJ'; end if;
  if nullif(btrim(p_organization_name),'') is null then raise exception 'INVALID_ORGANIZATION_NAME'; end if;
  if p_plan_id not in ('axiva','axiva_plus','axiva_max') then raise exception 'INVALID_PLAN'; end if;
  if nullif(btrim(p_contract_version),'') is null then raise exception 'CONTRACT_VERSION_REQUIRED'; end if;
  if nullif(btrim(p_signer_name),'') is null then raise exception 'SIGNER_NAME_REQUIRED'; end if;

  select om.organization_id into v_existing_org from public.organization_members om join public.organizations o on o.id=om.organization_id
  where om.user_id=v_user_id and om.is_active=true and om.deleted_at is null and o.cnpj=v_cnpj and o.is_active=true and o.deleted_at is null order by om.created_at limit 1;
  if v_existing_org is not null then v_org_id:=v_existing_org;
  else
    if exists(select 1 from public.organization_members where user_id=v_user_id and is_active=true and deleted_at is null) then raise exception 'USER_ALREADY_LINKED'; end if;
    if exists(select 1 from public.organizations where cnpj=v_cnpj) then raise exception 'CNPJ_ALREADY_REGISTERED'; end if;
    insert into public.organizations(name,created_by,cnpj) values(left(btrim(p_organization_name),160),v_user_id,v_cnpj) returning id into v_org_id;
    insert into public.organization_members(organization_id,user_id,role,is_active,display_name) values(v_org_id,v_user_id,'owner',true,left(btrim(p_signer_name),80));
    insert into public.organization_settings(organization_id,default_city,default_state,feature_flags,google_places_leads_per_capture,google_places_calls_per_capture) values(v_org_id,null,null,'{"leads":true,"capture":true,"messages":true,"whatsapp":true,"campaigns":true,"ai_assistant":true}'::jsonb,40,2);
    insert into public.ai_organization_settings(organization_id,enabled,daily_message_limit,daily_request_limit) values(v_org_id,true,10,10);
  end if;

  select email into v_email from auth.users where id=v_user_id;
  if nullif(btrim(v_email),'') is null then raise exception 'EMAIL_REQUIRED'; end if;
  insert into public.axiva_billing_accounts(organization_id,status,current_amount,default_plan_id,licensed_seats,updated_at)
  values(v_org_id,'pending',0,p_plan_id,v_qty,now()) on conflict (organization_id) do update set default_plan_id=excluded.default_plan_id,licensed_seats=greatest(public.axiva_billing_accounts.licensed_seats,excluded.licensed_seats),status=case when public.axiva_billing_accounts.status='cancelled' then 'pending' else public.axiva_billing_accounts.status end,updated_at=now();
  insert into public.axiva_paid_contract_acceptances(organization_id,user_id,plan_id,contract_version,signer_name,signer_email,cnpj,accepted_at,user_agent,status,license_quantity)
  values(v_org_id,v_user_id,p_plan_id,left(btrim(p_contract_version),100),left(btrim(p_signer_name),120),v_email,v_cnpj,now(),p_user_agent,'accepted',v_qty) returning id into v_contract_id;
  return query select v_org_id,v_contract_id,p_plan_id;
exception when unique_violation then raise exception 'CNPJ_ALREADY_REGISTERED';
end;$function$;
revoke all on function public.prepare_axiva_paid_contract_v2(text,text,text,text,text,text,integer) from public,anon;
grant execute on function public.prepare_axiva_paid_contract_v2(text,text,text,text,text,text,integer) to authenticated;