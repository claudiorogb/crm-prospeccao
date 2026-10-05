-- Paid onboarding: create the organization and record contract acceptance immediately before payment.
create or replace function public.prepare_axiva_paid_contract(
  p_cnpj text,
  p_organization_name text,
  p_plan_id text,
  p_contract_version text,
  p_signer_name text,
  p_user_agent text default null
)
returns table(organization_id uuid, contract_id uuid, plan_id text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_cnpj text := public.normalize_cnpj(p_cnpj);
  v_org_id uuid;
  v_contract_id uuid;
  v_email text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_cnpj is null or length(v_cnpj) <> 14 then raise exception 'INVALID_CNPJ'; end if;
  if nullif(btrim(p_organization_name),'') is null then raise exception 'INVALID_ORGANIZATION_NAME'; end if;
  if p_plan_id not in ('axiva','axiva_plus','axiva_max') then raise exception 'INVALID_PLAN'; end if;
  if nullif(btrim(p_contract_version),'') is null then raise exception 'CONTRACT_VERSION_REQUIRED'; end if;
  if nullif(btrim(p_signer_name),'') is null then raise exception 'SIGNER_NAME_REQUIRED'; end if;

  if exists (
    select 1 from public.organization_members
    where user_id = v_user_id and is_active = true and deleted_at is null
  ) then
    raise exception 'USER_ALREADY_LINKED';
  end if;

  if exists (select 1 from public.organizations where cnpj = v_cnpj) then
    raise exception 'CNPJ_ALREADY_REGISTERED';
  end if;

  select email into v_email from auth.users where id = v_user_id;
  if nullif(btrim(v_email),'') is null then raise exception 'EMAIL_REQUIRED'; end if;

  insert into public.organizations(name, created_by, cnpj)
  values (left(btrim(p_organization_name),160), v_user_id, v_cnpj)
  returning id into v_org_id;

  insert into public.organization_members(organization_id,user_id,role,is_active,display_name)
  values (v_org_id,v_user_id,'owner',true,left(btrim(p_signer_name),80));

  insert into public.organization_settings(
    organization_id,default_city,default_state,feature_flags,
    google_places_leads_per_capture,google_places_calls_per_capture
  )
  values (
    v_org_id,null,null,
    '{"leads":true,"capture":true,"messages":true,"whatsapp":true,"campaigns":true,"ai_assistant":true}'::jsonb,
    40,2
  );

  insert into public.ai_organization_settings(
    organization_id,enabled,daily_message_limit,daily_request_limit
  )
  values(v_org_id,true,10,10);

  insert into public.axiva_paid_contract_acceptances(
    organization_id,user_id,plan_id,contract_version,signer_name,signer_email,cnpj,
    accepted_at,user_agent,status
  )
  values(
    v_org_id,v_user_id,p_plan_id,left(btrim(p_contract_version),100),
    left(btrim(p_signer_name),120),v_email,v_cnpj,now(),p_user_agent,'accepted'
  )
  returning id into v_contract_id;

  return query select v_org_id,v_contract_id,p_plan_id;
exception
  when unique_violation then
    raise exception 'CNPJ_ALREADY_REGISTERED';
end;
$function$;

revoke execute on function public.prepare_axiva_paid_contract(text,text,text,text,text,text) from public;
revoke execute on function public.prepare_axiva_paid_contract(text,text,text,text,text,text) from anon;
grant execute on function public.prepare_axiva_paid_contract(text,text,text,text,text,text) to authenticated;