-- Fluxo automático de lembretes para cadastros sem e-mail confirmado + estatística no admin.
-- Não altera nenhum comportamento existente.

create table if not exists public.signup_confirmation_reminders (
  user_id uuid primary key,
  last_step integer not null default 0 check (last_step between 0 and 7),
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.signup_confirmation_reminders enable row level security;
revoke all on public.signup_confirmation_reminders from anon, authenticated;

-- Roda de hora em hora; a função decide quem recebe qual e-mail (dias 1, 2, 3, 4, 5, 10 e 15).
select cron.schedule(
  'axiva_signup_confirmation_reminders',
  '7 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/signup-confirmation-reminders',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Processor-Secret',(select decrypted_secret from vault.decrypted_secrets where name='axiva_email_processor_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);

-- Estatística "Cadastro não confirmado" no resumo de planos do admin.
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
      (a.plan_id='free_30_days') as is_trial_plan,
      (u.id is not null and u.email_confirmed_at is null and u.invited_at is null) as is_unconfirmed
    from public.organization_members om
    join public.organizations o on o.id=om.organization_id
    left join auth.users u on u.id=om.user_id
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
        case when b.plan_id is not null and not b.is_trial_plan and b.status<>'active' then 'cancelled' end,
        case when b.is_unconfirmed then 'unconfirmed' end
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
      'unconfirmed',          count(*) filter (where 'unconfirmed' = any(categories)),
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
