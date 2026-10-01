-- Allow a lost lead to return only through an authenticated prospecting reply
-- while preserving the existing manual recovery paths.
create or replace function private.enforce_lead_status_progression()
returns trigger
language plpgsql
set search_path to 'public','private'
as $function$
begin
  if new.status is not distinct from old.status then return new; end if;

  if old.status = 'interested' and new.status not in ('proposal','lost') then
    raise exception 'Transição inválida a partir de Interessado';
  elsif old.status = 'proposal' and new.status not in ('negotiation','lost') then
    raise exception 'Transição inválida a partir de Proposta';
  elsif old.status = 'negotiation' and new.status not in ('won','lost') then
    raise exception 'Transição inválida a partir de Negociação';
  elsif old.status = 'won' then
    raise exception 'Negócio ganho é etapa terminal';
  elsif old.status = 'lost' then
    if new.status in ('interested','proposal','negotiation') then
      return new;
    elsif new.status = 'replied'
      and current_user in ('service_role','postgres','supabase_admin')
      and current_setting('app.lead_status_reason', true) = 'prospecting_reply' then
      return new;
    else
      raise exception 'Lead perdido só pode voltar por recuperação manual ou por resposta real de prospecção';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.email_mark_prospecting_reply(p_recipient_id uuid)
returns table(lead_id uuid, campaign_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_lead uuid;
  v_campaign uuid;
  v_org uuid;
  v_remaining integer;
  v_failed integer;
  v_sent integer;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'service_role only' using errcode='42501';
  end if;

  select r.lead_id,r.campaign_id,r.organization_id
    into v_lead,v_campaign,v_org
  from public.email_campaign_recipients r
  join public.email_campaigns c on c.id=r.campaign_id and c.sequence_mode=true
  where r.id=p_recipient_id and r.recipient_source='crm_prospecting'
  for update of r;

  if v_campaign is null then return; end if;

  update public.email_campaign_recipients
     set status='replied',replied_at=coalesce(replied_at,now()),next_attempt_at=null,updated_at=now()
   where id=p_recipient_id and status in ('queued','sending');

  if v_lead is not null then
    perform set_config('app.lead_status_reason','prospecting_reply',true);
    update public.leads
       set status='replied',updated_at=now()
     where id=v_lead and organization_id=v_org and deleted_at is null
       and status in ('captured_pending','new','queued','contacted','contacted_pending','lost');
  end if;

  select count(*) filter(where r.status in ('draft','queued','sending')),
         count(*) filter(where r.status='failed'),
         count(*) filter(where r.status='sent')
    into v_remaining,v_failed,v_sent
  from public.email_campaign_recipients r
  where r.campaign_id=v_campaign;

  update public.email_campaigns
     set status=case when v_remaining=0 then 'completed' else status end,
         sent_count=v_sent,failed_count=v_failed,
         completed_at=case when v_remaining=0 then coalesce(completed_at,now()) else completed_at end,
         updated_at=now()
   where id=v_campaign;

  return query select v_lead,v_campaign;
end;
$function$;

update public.email_platform_config
set generic_reply_address='resposta@crmaxiva.com.br',
    generic_reply_domain_id='bf62891e-38eb-46df-b251-a725fd5f063e',
    generic_reply_status='not_started'
where singleton=true;
