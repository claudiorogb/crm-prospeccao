-- Fix prospecting reply stop/Kanban rule and route forwarded replies to a real inbox.

alter table public.email_connections
  add column if not exists reply_forward_email text;

update public.email_connections ec
set reply_forward_email = au.email,
    updated_at = now()
from auth.users au
where ec.connected_by = au.id
  and (ec.reply_forward_email is null or btrim(ec.reply_forward_email)='');

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
    update public.leads
       set status='replied',updated_at=now()
     where id=v_lead and organization_id=v_org and deleted_at is null
       and status in ('captured_pending','new','queued','contacted','contacted_pending');
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
