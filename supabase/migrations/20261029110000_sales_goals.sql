-- Metas mensais por empresa (user_id nulo) e por vendedor. Tabela nova, aditiva, isolada por organização.
create table if not exists public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  target_won_count integer check (target_won_count is null or target_won_count >= 0),
  target_value numeric(14,2) check (target_value is null or target_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_goals_unique_idx
  on public.sales_goals (organization_id, period, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.sales_goals enable row level security;

create policy sales_goals_member_select on public.sales_goals for select to authenticated
  using (private.is_active_org_member(organization_id));
create policy sales_goals_admin_insert on public.sales_goals for insert to authenticated
  with check (private.has_org_role(organization_id, array['admin','owner']));
create policy sales_goals_admin_update on public.sales_goals for update to authenticated
  using (private.has_org_role(organization_id, array['admin','owner']))
  with check (private.has_org_role(organization_id, array['admin','owner']));
create policy sales_goals_admin_delete on public.sales_goals for delete to authenticated
  using (private.has_org_role(organization_id, array['admin','owner']));
