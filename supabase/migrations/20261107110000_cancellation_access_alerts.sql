-- Alertas de fim de acesso para planos cancelados (Billing V2).
-- Aditivo: não altera nenhuma tabela, função ou rotina existente.

-- 1) Controle dos lembretes por e-mail (7 dias, 3 dias e último dia): um registro por empresa/data/lembrete.
create table if not exists public.axiva_cancellation_reminders (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  access_until date not null,
  kind text not null check (kind in ('d7','d3','d0')),
  recipients text[] not null default '{}',
  sent_at timestamptz not null default now(),
  primary key (organization_id, access_until, kind)
);
alter table public.axiva_cancellation_reminders enable row level security;
revoke all on public.axiva_cancellation_reminders from anon, authenticated;

-- 2) Dados da faixa na tela: devolve o fim do acesso quando a empresa do usuário cancelou o plano e o acesso ainda vale.
create or replace function public.get_my_cancellation_notice()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_org uuid;
  v_until date;
begin
  select m.organization_id into v_org
    from public.organization_members m
   where m.user_id = auth.uid() and m.is_active and m.deleted_at is null
   order by m.created_at asc
   limit 1;
  if v_org is null then return null; end if;

  select a.access_until into v_until
    from public.axiva_billing_v2_accounts a
   where a.organization_id = v_org
     and a.cancelled_at is not null and a.access_until is not null
     and a.status in ('active','past_due')
     and a.access_until >= v_today
   limit 1;
  if v_until is null then return null; end if;

  return jsonb_build_object('access_until', v_until, 'days_left', v_until - v_today);
end;
$$;
revoke all on function public.get_my_cancellation_notice() from public, anon;
grant execute on function public.get_my_cancellation_notice() to authenticated;

-- 3) Roda de hora em hora; a função só envia a partir das 8h (Brasília) e nunca repete um lembrete.
select cron.schedule(
  'axiva_cancellation_access_reminders',
  '12 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/cancellation-access-reminders',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Processor-Secret',(select decrypted_secret from vault.decrypted_secrets where name='axiva_email_processor_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);
