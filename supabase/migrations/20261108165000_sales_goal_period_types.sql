-- Metas independentes por empresa/vendedor e por periodicidade.
-- Metas mensais existentes permanecem classificadas como "month".
-- Nenhuma política RLS ou permissão existente é alterada.

alter table public.sales_goals
  add column period_type text not null default 'month';

alter table public.sales_goals
  add constraint sales_goals_period_type_check
  check (period_type in ('month', 'quarter', 'semester', 'year'));

-- O campo period segue sendo a data do primeiro dia do mês inicial do período.
-- Isso preserva a estrutura date existente e permite diferenciar metas mensais e trimestrais
-- que tenham o mesmo mês de início.
alter table public.sales_goals
  add constraint sales_goals_period_type_alignment_check
  check (
    (period_type = 'month')
    or (period_type = 'quarter' and extract(month from period)::integer in (1, 4, 7, 10))
    or (period_type = 'semester' and extract(month from period)::integer in (1, 7))
    or (period_type = 'year' and extract(month from period)::integer = 1)
  );

drop index public.sales_goals_unique_idx;

create unique index sales_goals_unique_idx
  on public.sales_goals (
    organization_id,
    period,
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_type
  );

comment on column public.sales_goals.period_type is
  'Periodicidade da meta: month, quarter, semester ou year. A data period é o primeiro dia do primeiro mês do período.';
