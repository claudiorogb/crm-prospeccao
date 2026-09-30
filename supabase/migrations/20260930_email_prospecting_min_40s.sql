-- AXIVA CRM - intervalo mínimo de 40 segundos entre e-mails de prospecção
-- A regra é aplicada no banco para Gmail e Resend, inclusive sequências.

alter table public.organization_email_limits
  alter column send_interval_seconds set default 40;

update public.organization_email_limits
   set send_interval_seconds = 40,
       updated_at = now()
 where send_interval_seconds <> 40;

alter table public.organization_email_limits
  drop constraint if exists organization_email_limits_send_interval_seconds_check;

alter table public.organization_email_limits
  add constraint organization_email_limits_send_interval_seconds_check
  check (send_interval_seconds >= 40 and send_interval_seconds <= 86400);

create or replace function public.email_claim_next_recipient()
returns table(recipient_id uuid, campaign_id uuid, organization_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'service_role only' using errcode='42501';
  end if;

  update public.organization_email_limits
     set sent_today=0,usage_date=v_today,updated_at=now()
   where usage_date<>v_today;

  return query
  with candidate as (
    select r.id recipient_id,r.campaign_id claimed_campaign_id,r.organization_id claimed_organization_id
    from public.email_campaign_recipients r
    join public.email_campaigns c on c.id=r.campaign_id and c.organization_id=r.organization_id
    join public.organization_email_limits l on l.organization_id=r.organization_id
    join public.email_connections ec on ec.organization_id=r.organization_id and ec.status='connected'
    where r.status='queued'
      and c.status in ('queued','sending')
      and c.sequence_mode=false
      and c.provider in ('gmail','resend')
      and coalesce(c.scheduled_at,now())<=now()
      and not l.sending_paused
      and l.daily_send_limit > l.sent_today + (
        select count(*)
        from public.email_campaign_recipients inflight
        where inflight.organization_id=l.organization_id
          and inflight.status='sending'
      )
      and not exists (
        select 1
        from public.email_marketing_contacts mc
        where mc.organization_id=r.organization_id
          and mc.email_normalized=lower(btrim(r.recipient_email))
          and (mc.status<>'active' or mc.unsubscribed_at is not null)
      )
      and not exists (
        select 1
        from public.leads opt
        where opt.organization_id=r.organization_id
          and opt.deleted_at is null
          and lower(btrim(coalesce(opt.email,'')))=lower(btrim(r.recipient_email))
          and opt.email_marketing_opt_out=true
      )
      and (r.next_attempt_at is null or r.next_attempt_at<=now())
      and (
        l.last_sent_at is null
        or l.last_sent_at <= now() - make_interval(secs=>greatest(l.send_interval_seconds,40))
      )
    order by r.created_at
    for update of r,l skip locked
    limit 1
  ), upd as (
    update public.email_campaign_recipients r
       set status='sending',
           attempt_count=r.attempt_count+1,
           last_attempt_at=now(),
           updated_at=now()
      from candidate c
     where r.id=c.recipient_id
    returning r.id recipient_id,r.campaign_id claimed_campaign_id,r.organization_id claimed_organization_id
  ), reserve_interval as (
    update public.organization_email_limits l
       set last_sent_at=now(),updated_at=now()
      from upd u
     where l.organization_id=u.claimed_organization_id
    returning l.organization_id
  )
  select u.recipient_id,u.claimed_campaign_id,u.claimed_organization_id
  from upd u
  join reserve_interval x on x.organization_id=u.claimed_organization_id;
end;
$function$;

create or replace function public.email_claim_next_sequence_recipient()
returns table(recipient_id uuid, campaign_id uuid, organization_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'service_role only' using errcode='42501';
  end if;

  update public.organization_email_limits
     set sent_today=0,usage_date=v_today,updated_at=now()
   where usage_date<>v_today;

  return query
  with candidate as (
    select r.id recipient_id,r.campaign_id claimed_campaign_id,r.organization_id claimed_organization_id
    from public.email_campaign_recipients r
    join public.email_campaigns c on c.id=r.campaign_id and c.organization_id=r.organization_id
    join public.organization_email_limits l on l.organization_id=r.organization_id
    join public.email_connections ec on ec.organization_id=r.organization_id
      and ec.status='connected'
      and ec.provider=c.provider
    where r.status='queued'
      and r.recipient_source='crm_prospecting'
      and c.status in ('queued','sending')
      and c.sequence_mode=true
      and c.provider in ('gmail','resend')
      and coalesce(c.scheduled_at,now())<=now()
      and r.replied_at is null
      and not l.sending_paused
      and l.daily_send_limit > l.sent_today + (
        select count(*)
        from public.email_campaign_recipients inflight
        where inflight.organization_id=l.organization_id
          and inflight.status='sending'
      )
      and not exists (
        select 1
        from public.leads opt
        where opt.organization_id=r.organization_id
          and opt.deleted_at is null
          and lower(btrim(coalesce(opt.email,'')))=lower(btrim(r.recipient_email))
          and opt.email_marketing_opt_out=true
      )
      and (r.next_attempt_at is null or r.next_attempt_at<=now())
      and (
        l.last_sent_at is null
        or l.last_sent_at <= now() - make_interval(secs=>greatest(l.send_interval_seconds,40))
      )
    order by r.next_attempt_at nulls first,r.created_at
    for update of r,l skip locked
    limit 1
  ), upd as (
    update public.email_campaign_recipients r
       set status='sending',
           attempt_count=r.attempt_count+1,
           last_attempt_at=now(),
           updated_at=now()
      from candidate c
     where r.id=c.recipient_id
    returning r.id recipient_id,r.campaign_id claimed_campaign_id,r.organization_id claimed_organization_id
  ), reserve_interval as (
    update public.organization_email_limits l
       set last_sent_at=now(),updated_at=now()
      from upd u
     where l.organization_id=u.claimed_organization_id
    returning l.organization_id
  )
  select u.recipient_id,u.claimed_campaign_id,u.claimed_organization_id
  from upd u
  join reserve_interval x on x.organization_id=u.claimed_organization_id;
end;
$function$;

do $$
begin
  if exists (select 1 from cron.job where jobname='axiva_email_queue_processor') then
    perform cron.unschedule('axiva_email_queue_processor');
  end if;
end;
$$;

select cron.schedule(
  'axiva_email_queue_processor',
  '40 seconds',
  $cron$
    select net.http_post(
      url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/email-queue-processor',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Processor-Secret',(select decrypted_secret from vault.decrypted_secrets where name='axiva_email_processor_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);

do $$
begin
  if exists (select 1 from cron.job where jobname='axiva_email_sequence_processor') then
    perform cron.unschedule('axiva_email_sequence_processor');
  end if;
end;
$$;

select cron.schedule(
  'axiva_email_sequence_processor',
  '40 seconds',
  $cron$
    select net.http_post(
      url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/email-sequence-processor',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Processor-Secret',(select decrypted_secret from vault.decrypted_secrets where name='axiva_email_processor_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);