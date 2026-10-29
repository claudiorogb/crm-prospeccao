-- Probabilidade de fechamento por etapa, configurável por empresa. Tabela nova, aditiva.
create table if not exists public.forecast_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  probabilities jsonb not null default '{"interested":10,"proposal":30,"negotiation":60}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.forecast_settings enable row level security;
create policy forecast_settings_member_select on public.forecast_settings for select to authenticated
  using (private.is_active_org_member(organization_id));
create policy forecast_settings_admin_insert on public.forecast_settings for insert to authenticated
  with check (private.has_org_role(organization_id, array['admin','owner']));
create policy forecast_settings_admin_update on public.forecast_settings for update to authenticated
  using (private.has_org_role(organization_id, array['admin','owner']))
  with check (private.has_org_role(organization_id, array['admin','owner']));
