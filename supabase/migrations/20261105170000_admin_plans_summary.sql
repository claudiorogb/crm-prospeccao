-- Resumo de planos para a área de administrador do sistema.
-- 1) Histórico de trial (o trial é apagado de user_plan_assignments quando o usuário paga).
-- 2) RPC admin_plans_summary (somente system_admins).
-- Não altera nenhuma função, política ou dado existente.

create table if not exists public.user_trial_history (
  organization_id uuid not null,
  user_id uuid not null,
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz,
  outcome text not null default 'trial' check (outcome in ('trial','paid','cancelled')),
  paid_at timestamptz,
  cancelled_at timestamptz,
  primary key (organization_id, user_id)
);
alter table public.user_trial_history enable row level security;
revoke all on public.user_trial_history from anon, authenticated;

create or replace function public.track_user_trial_history()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  begin
    if new.plan_id = 'free_30_days' and new.trial_started_at is not null then
      insert into public.user_trial_history(organization_id,user_id,trial_started_at,trial_ends_at,outcome)
      values (new.organization_id,new.user_id,new.trial_started_at,new.trial_ends_at,'trial')
      on conflict (organization_id,user_id) do update
        set trial_started_at=excluded.trial_started_at, trial_ends_at=excluded.trial_ends_at,
            outcome='trial', paid_at=null, cancelled_at=null;
    elsif tg_op = 'UPDATE' then
      if old.plan_id = 'free_30_days' and new.plan_id <> 'free_30_days' and new.status = 'active' then
        update public.user_trial_history
           set outcome='paid', paid_at=now()
         where organization_id=new.organization_id and user_id=new.user_id and outcome='trial';
      elsif new.status <> 'active' and old.status = 'active' then
        update public.user_trial_history
           set outcome='cancelled', cancelled_at=now()
         where organization_id=new.organization_id and user_id=new.user_id and outcome='paid';
      elsif new.status = 'active' and old.status <> 'active' then
        update public.user_trial_history
           set outcome='paid', cancelled_at=null
         where organization_id=new.organization_id and user_id=new.user_id and outcome='cancelled';
      end if;
    end if;
  exception when others then
    null; -- o histórico nunca pode impedir a troca de plano
  end;
  return new;
end;
$$;

drop trigger if exists trg_track_user_trial_history on public.user_plan_assignments;
create trigger trg_track_user_trial_history
after insert or update on public.user_plan_assignments
for each row execute function public.track_user_trial_history();

-- Preenche o histórico dos trials que existem hoje.
insert into public.user_trial_history(organization_id,user_id,trial_started_at,trial_ends_at,outcome)
select a.organization_id,a.user_id,a.trial_started_at,a.trial_ends_at,'trial'
from public.user_plan_assignments a
where a.plan_id='free_30_days' and a.trial_started_at is not null
on conflict do nothing;

create or replace function public.admin_plans_summary()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_result jsonb;
begin
  if not exists(select 1 from public.system_admins where user_id=auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  with base as (
    select
      om.organization_id, om.user_id, a.plan_id, a.status, a.trial_ends_at, h.outcome as trial_outcome,
      (a.plan_id='free_30_days') as is_trial_plan
    from public.organization_members om
    join public.organizations o on o.id=om.organization_id
    left join public.user_plan_assignments a on a.organization_id=om.organization_id and a.user_id=om.user_id
    left join public.user_trial_history h on h.organization_id=om.organization_id and h.user_id=om.user_id
    where om.is_active=true and om.deleted_at is null
      and o.is_active=true and o.deleted_at is null and o.is_sandbox=false
  ), cat as (
    select b.*,
      array_remove(array[
        case when b.plan_id is not null and not b.is_trial_plan and b.status='active' then 'paying' end,
        case when b.is_trial_plan and b.status='active' and b.trial_ends_at>now() then 'trial' end,
        case when b.is_trial_plan and (b.status<>'active' or b.trial_ends_at<=now()) then 'trial_expired' end,
        case when b.trial_outcome in ('paid','cancelled') then 'paid_after_trial' end,
        case when b.trial_outcome='cancelled' then 'cancelled_after_trial' end,
        case when b.plan_id is not null and not b.is_trial_plan and b.status<>'active' then 'cancelled' end
      ], null) as categories
    from base b
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'paying',               count(*) filter (where 'paying' = any(categories)),
      'trial',                count(*) filter (where 'trial' = any(categories)),
      'trial_expired',        count(*) filter (where 'trial_expired' = any(categories)),
      'paid_after_trial',     count(*) filter (where 'paid_after_trial' = any(categories)),
      'cancelled_after_trial',count(*) filter (where 'cancelled_after_trial' = any(categories)),
      'cancelled',            count(*) filter (where 'cancelled' = any(categories)),
      'total_users',          count(*)
    ),
    'by_plan', coalesce((
      select jsonb_agg(jsonb_build_object('plan_id',p.id,'plan_name',p.name,'users',coalesce(c.n,0)) order by p.price_monthly)
      from public.crm_plans p
      left join (
        select plan_id, count(*) n from cat where status='active' and plan_id is not null group by plan_id
      ) c on c.plan_id=p.id
      where p.is_active=true
    ), '[]'::jsonb),
    'users', coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'organization_id',organization_id,'categories',to_jsonb(categories))), '[]'::jsonb)
  ) into v_result
  from cat;

  return v_result;
end;
$$;

revoke all on function public.admin_plans_summary() from public, anon;
grant execute on function public.admin_plans_summary() to authenticated;
