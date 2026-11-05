-- Limites de captação semanal (Google) e de IA acompanham o plano do usuário.
-- Regras:
--   * Captações por semana da empresa = soma, dos usuários ativos, das captações semanais do plano de cada um.
--   * IA por dia do usuário = limite diário do plano (crm_plans.ai_daily_limit).
--   * Limite diário da empresa (IA) nunca fica abaixo da soma dos limites dos usuários (nunca é reduzido).
--   * Empresas com limite semanal definido manualmente pelo administrador do sistema não são alteradas.

alter table public.crm_plans add column if not exists weekly_captures integer;
update public.crm_plans set weekly_captures = case id
  when 'free_30_days' then 1
  when 'axiva' then 1
  when 'axiva_plus' then 3
  when 'axiva_max' then 6
  else weekly_captures end
where id in ('free_30_days','axiva','axiva_plus','axiva_max');

alter table public.organization_settings add column if not exists capture_limits_manual boolean not null default false;
-- Quem já tem limite definido hoje foi configurado pelo administrador: preserva.
update public.organization_settings set capture_limits_manual = true where lead_capture_weekly_limit is not null;

-- Quando o administrador salva o limite de uma empresa, passa a valer o valor dele.
create or replace function public.admin_set_lead_capture_settings(p_organization_id uuid, p_weekly_limit integer, p_leads_per_capture integer, p_calls_per_capture integer)
 returns table(weekly_limit integer, leads_per_capture integer, calls_per_capture integer)
 language plpgsql
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not private.is_system_admin() then raise exception 'Forbidden'; end if;
  if p_weekly_limit is not null and p_weekly_limit < 0 then raise exception 'Weekly limit must be null or zero or greater'; end if;
  if p_leads_per_capture < 1 then raise exception 'Leads per capture must be one or greater'; end if;
  if p_calls_per_capture < 1 or p_calls_per_capture > 20 then raise exception 'Google search calls per capture must be between 1 and 20'; end if;
  update public.organization_settings
  set lead_capture_weekly_limit=p_weekly_limit,
      google_places_leads_per_capture=p_leads_per_capture,
      google_places_calls_per_capture=p_calls_per_capture,
      capture_limits_manual=true,
      updated_at=now()
  where organization_id=p_organization_id
  returning lead_capture_weekly_limit,google_places_leads_per_capture,google_places_calls_per_capture
  into weekly_limit,leads_per_capture,calls_per_capture;
  if not found then raise exception 'Organization settings not found'; end if;
  return next;
end;
$function$;

create or replace function public.apply_plan_limits(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_weekly integer;
  v_ai integer;
begin
  select sum(cp.weekly_captures), sum(cp.ai_daily_limit)
    into v_weekly, v_ai
  from public.user_plan_assignments a
  join public.crm_plans cp on cp.id = a.plan_id
  where a.organization_id = p_organization_id and a.status = 'active';

  if coalesce(v_weekly,0) > 0 then
    update public.organization_settings os
       set lead_capture_weekly_limit = v_weekly, updated_at = now()
     where os.organization_id = p_organization_id
       and os.capture_limits_manual = false
       and os.lead_capture_weekly_limit is distinct from v_weekly;
  end if;

  if coalesce(v_ai,0) > 0 then
    update public.ai_organization_settings ai
       set daily_request_limit = v_ai, updated_at = now()
     where ai.organization_id = p_organization_id
       and coalesce(ai.daily_request_limit,0) < v_ai;
  end if;
end;
$$;
revoke all on function public.apply_plan_limits(uuid) from public, anon, authenticated;

create or replace function public.sync_plan_limits_on_assignment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plan_changed boolean := false;
  v_became_active boolean := false;
begin
  begin
    if tg_op = 'INSERT' then
      v_plan_changed := true;
      v_became_active := true;
    else
      v_plan_changed := old.plan_id is distinct from new.plan_id;
      v_became_active := old.status is distinct from new.status;
    end if;

    -- IA por dia do usuário acompanha o plano quando o plano muda (mesma regra já usada em change_plan).
    if new.status = 'active' and (v_plan_changed or v_became_active) then
      insert into public.ai_user_settings(organization_id, user_id, daily_message_limit, updated_at)
      select new.organization_id, new.user_id, cp.ai_daily_limit, now()
      from public.crm_plans cp
      where cp.id = new.plan_id and cp.ai_daily_limit is not null
      on conflict (organization_id, user_id) do update
        set daily_message_limit = case when v_plan_changed then excluded.daily_message_limit else public.ai_user_settings.daily_message_limit end,
            updated_at = now();
    end if;
    perform public.apply_plan_limits(new.organization_id);
  exception when others then
    null; -- limites nunca podem impedir a troca de plano
  end;
  return new;
end;
$$;

drop trigger if exists trg_sync_plan_limits on public.user_plan_assignments;
create trigger trg_sync_plan_limits
after insert or update of plan_id, status on public.user_plan_assignments
for each row execute function public.sync_plan_limits_on_assignment();

-- Corrige as empresas atuais sem limite (não toca nas que o administrador configurou).
insert into public.ai_user_settings(organization_id, user_id, daily_message_limit, updated_at)
select a.organization_id, a.user_id, cp.ai_daily_limit, now()
from public.user_plan_assignments a
join public.crm_plans cp on cp.id = a.plan_id
join public.organizations o on o.id = a.organization_id and o.is_sandbox = false
where a.status = 'active' and cp.ai_daily_limit is not null
on conflict (organization_id, user_id) do nothing;

do $$
declare r record;
begin
  for r in select distinct a.organization_id from public.user_plan_assignments a
           join public.organizations o on o.id = a.organization_id and o.is_sandbox = false loop
    perform public.apply_plan_limits(r.organization_id);
  end loop;
end $$;
