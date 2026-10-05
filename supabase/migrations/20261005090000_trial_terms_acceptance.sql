-- Trial terms acceptance and server-side one-trial-per-CNPJ enforcement
create table if not exists public.axiva_trial_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  organization_id uuid references public.organizations(id),
  cnpj text not null,
  email text not null,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null
);

alter table public.axiva_trial_terms_acceptances enable row level security;
revoke all on public.axiva_trial_terms_acceptances from anon, authenticated;
revoke all on public.axiva_trial_terms_acceptances from public;

create unique index if not exists organizations_cnpj_unique_idx
  on public.organizations(cnpj)
  where cnpj is not null;

create index if not exists axiva_trial_terms_acceptances_user_idx
  on public.axiva_trial_terms_acceptances(user_id);

create index if not exists axiva_trial_terms_acceptances_cnpj_idx
  on public.axiva_trial_terms_acceptances(cnpj);

drop function if exists public.start_axiva_trial(text,text,text,text);

create or replace function public.start_axiva_trial(
  p_cnpj text,
  p_organization_name text,
  p_city text default null,
  p_state text default null,
  p_terms_version text default null,
  p_privacy_version text default null,
  p_terms_accepted boolean default false,
  p_accepted_at timestamptz default null
)
returns table(
  organization_id uuid,
  plan_id text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_cnpj text := public.normalize_cnpj(p_cnpj);
  v_org_id uuid;
  v_existing_org uuid;
  v_email text;
  v_start timestamptz := now();
  v_end timestamptz := now() + interval '30 days';
  v_accepted_at timestamptz := coalesce(p_accepted_at, v_start);
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_cnpj is null or length(v_cnpj) <> 14 then raise exception 'INVALID_CNPJ'; end if;
  if nullif(btrim(p_organization_name),'') is null then raise exception 'INVALID_ORGANIZATION_NAME'; end if;
  if p_terms_accepted is not true
     or nullif(btrim(p_terms_version),'') is null
     or nullif(btrim(p_privacy_version),'') is null then
    raise exception 'TERMS_ACCEPTANCE_REQUIRED';
  end if;

  if exists (
    select 1 from public.organization_members
    where user_id = v_user_id and is_active = true and deleted_at is null
  ) then
    raise exception 'USER_ALREADY_LINKED';
  end if;

  select id into v_existing_org
  from public.organizations
  where cnpj = v_cnpj
  limit 1;

  if v_existing_org is not null then raise exception 'CNPJ_TRIAL_ALREADY_USED'; end if;

  select email into v_email from auth.users where id = v_user_id;
  if nullif(btrim(v_email),'') is null then raise exception 'EMAIL_REQUIRED'; end if;

  begin
    insert into public.organizations(name,created_by,cnpj,trial_used_at)
    values (left(btrim(p_organization_name),160),v_user_id,v_cnpj,v_start)
    returning id into v_org_id;
  exception
    when unique_violation then raise exception 'CNPJ_TRIAL_ALREADY_USED';
  end;

  insert into public.organization_members(organization_id,user_id,role,is_active,display_name)
  values (v_org_id,v_user_id,'owner',true,left(btrim(p_organization_name),80));

  insert into public.organization_settings(
    organization_id,default_city,default_state,feature_flags,
    google_places_leads_per_capture,google_places_calls_per_capture
  )
  values (
    v_org_id,nullif(btrim(p_city),''),
    nullif(upper(btrim(p_state)),''),
    '{"leads":true,"capture":true,"messages":true,"whatsapp":true,"campaigns":true,"ai_assistant":true}'::jsonb,
    40,2
  );

  insert into public.ai_organization_settings(
    organization_id,enabled,daily_message_limit,daily_request_limit
  )
  values(v_org_id,true,10,10);

  insert into public.user_plan_assignments(
    organization_id,user_id,plan_id,status,trial_started_at,trial_ends_at,assigned_by
  )
  values(v_org_id,v_user_id,'axiva','active',v_start,v_end,v_user_id);

  insert into public.axiva_trial_terms_acceptances(
    user_id,organization_id,cnpj,email,terms_version,privacy_version,
    accepted_at,trial_started_at,trial_ends_at
  )
  values(
    v_user_id,v_org_id,v_cnpj,v_email,
    left(btrim(p_terms_version),100),
    left(btrim(p_privacy_version),100),
    v_accepted_at,v_start,v_end
  );

  return query select v_org_id,'axiva'::text,v_start,v_end;
end;
$function$;

revoke all on function public.start_axiva_trial(text,text,text,text,text,text,boolean,timestamptz) from public, anon;
grant execute on function public.start_axiva_trial(text,text,text,text,text,text,boolean) to authenticated;
