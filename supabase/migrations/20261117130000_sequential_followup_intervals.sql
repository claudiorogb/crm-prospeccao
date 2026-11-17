-- Alinha a sequência de e-mail à mesma regra sucessiva do WhatsApp.
-- Registros existentes permanecem com a interpretação antiga (dias acumulados).
alter table public.email_campaigns
  add column if not exists followup_intervals_sequential boolean not null default false;

create or replace function public.create_email_prospecting_sequence_v2(
  p_organization_id uuid,
  p_name text,
  p_subject text,
  p_body_text text,
  p_followup1_body text,
  p_followup2_body text,
  p_lead_ids uuid[],
  p_followup1_day integer default 5,
  p_followup2_day integer default 7
)
returns table(campaign_id uuid, recipient_count integer)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_created record;
begin
  if auth.uid() is null
     or not private.has_org_role(p_organization_id, array['member','admin','owner']::text[]) then
    raise exception 'Sem permissão para iniciar prospecção por e-mail.' using errcode='42501';
  end if;

  if p_followup1_day is null or p_followup2_day is null
     or p_followup1_day < 2 or p_followup1_day > 30
     or p_followup2_day < 2 or p_followup2_day > 30 then
    raise exception 'Informe intervalos entre 2 e 30 dias para cada follow-up.';
  end if;

  -- Reutiliza a validação, seleção de contatos, opt-out, conexão e fila
  -- já existentes. Os valores temporários são substituídos antes do commit.
  select * into v_created
  from public.create_email_prospecting_sequence(
    p_organization_id,
    p_name,
    p_subject,
    p_body_text,
    p_followup1_body,
    p_followup2_body,
    p_lead_ids,
    2,
    3
  );

  update public.email_campaigns
     set followup1_day = p_followup1_day,
         followup2_day = p_followup2_day,
         followup_intervals_sequential = true,
         updated_at = now()
   where id = v_created.campaign_id
     and organization_id = p_organization_id
     and sequence_mode = true;

  if not found then
    raise exception 'Não foi possível configurar os intervalos da sequência.';
  end if;

  return query select v_created.campaign_id, v_created.recipient_count;
end;
$function$;

revoke all on function public.create_email_prospecting_sequence_v2(uuid,text,text,text,text,text,uuid[],integer,integer) from public, anon;
grant execute on function public.create_email_prospecting_sequence_v2(uuid,text,text,text,text,text,uuid[],integer,integer) to authenticated;

create or replace function public.email_complete_recipient(
  p_recipient_id uuid,
  p_success boolean,
  p_provider_message_id text,
  p_error text,
  p_retry_after_seconds integer default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_campaign uuid;
  v_org uuid;
  v_sequence boolean;
  v_sequential_intervals boolean;
  v_step smallint;
  v_replied_at timestamptz;
  v_f1 smallint;
  v_f2 smallint;
  v_remaining integer;
  v_failed integer;
  v_sent integer;
  v_next_delay integer;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'service_role only' using errcode='42501';
  end if;

  select r.campaign_id,r.organization_id,c.sequence_mode,c.followup_intervals_sequential,
         r.sequence_step,r.replied_at,c.followup1_day,c.followup2_day
    into v_campaign,v_org,v_sequence,v_sequential_intervals,v_step,v_replied_at,v_f1,v_f2
  from public.email_campaign_recipients r
  join public.email_campaigns c on c.id=r.campaign_id
  where r.id=p_recipient_id
  for update of r;

  if v_campaign is null then return; end if;

  if p_success then
    update public.organization_email_limits
       set sent_today=case when usage_date=(now() at time zone 'America/Sao_Paulo')::date then sent_today+1 else 1 end,
           usage_date=(now() at time zone 'America/Sao_Paulo')::date,
           last_sent_at=now(),updated_at=now()
     where organization_id=v_org;

    if v_replied_at is not null then
      update public.email_campaign_recipients
         set status='replied',provider_message_id=coalesce(p_provider_message_id,provider_message_id),
             error_message=null,next_attempt_at=null,updated_at=now()
       where id=p_recipient_id;
    elsif v_sequence and v_step < 3 then
      v_next_delay := case
        when v_sequential_intervals then
          case when v_step=1 then greatest(v_f1,1) else greatest(v_f2,1) end
        else
          case when v_step=1 then greatest(v_f1-1,1) else greatest(v_f2-v_f1,1) end
      end;

      update public.email_campaign_recipients
         set status='queued',
             sequence_step=v_step+1,
             provider_message_id=coalesce(p_provider_message_id,provider_message_id),
             error_message=null,
             sent_at=coalesce(sent_at,now()),
             next_attempt_at=now()+make_interval(days=>v_next_delay),
             updated_at=now()
       where id=p_recipient_id;
    else
      update public.email_campaign_recipients
         set status='sent',
             provider_message_id=coalesce(p_provider_message_id,provider_message_id),
             error_message=null,
             sent_at=coalesce(sent_at,now()),
             next_attempt_at=null,
             updated_at=now()
       where id=p_recipient_id;
    end if;
  elsif p_retry_after_seconds is not null and p_retry_after_seconds>0 then
    update public.email_campaign_recipients
       set status=case when replied_at is not null then 'replied' else 'queued' end,
           error_message=p_error,
           next_attempt_at=case when replied_at is not null then null else now()+make_interval(secs=>p_retry_after_seconds) end,
           updated_at=now()
     where id=p_recipient_id;
  else
    update public.email_campaign_recipients
       set status=case when replied_at is not null then 'replied' else 'failed' end,
           error_message=p_error,
           next_attempt_at=null,
           updated_at=now()
     where id=p_recipient_id;
  end if;

  select count(*) filter(where status in ('draft','queued','sending')),
         count(*) filter(where status='failed'),
         count(*) filter(where status='sent')
    into v_remaining,v_failed,v_sent
  from public.email_campaign_recipients
  where campaign_id=v_campaign;

  update public.email_campaigns
     set status=case when v_remaining=0 then 'completed' else 'sending' end,
         sent_count=v_sent,
         failed_count=v_failed,
         started_at=coalesce(started_at,now()),
         completed_at=case when v_remaining=0 then now() else null end,
         updated_at=now()
   where id=v_campaign and status not in ('cancelled','completed');
end;
$function$;

revoke all on function public.email_complete_recipient(uuid,boolean,text,text,integer) from public, anon, authenticated;
grant execute on function public.email_complete_recipient(uuid,boolean,text,text,integer) to service_role;
