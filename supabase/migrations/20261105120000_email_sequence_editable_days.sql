-- Dias do 2º e 3º contato da sequência de prospecção por e-mail passam a ser editáveis.
-- Padrão continua D1 · D4 · D8 (campanhas existentes não mudam de comportamento).
alter table public.email_campaigns
  add column if not exists followup1_day smallint not null default 4,
  add column if not exists followup2_day smallint not null default 8;

alter table public.email_campaigns
  drop constraint if exists email_campaigns_followup_days_check;
alter table public.email_campaigns
  add constraint email_campaigns_followup_days_check
  check (followup1_day between 2 and 30 and followup2_day > followup1_day and followup2_day <= 60);

drop function if exists public.create_email_prospecting_sequence(uuid,text,text,text,text,text,uuid[]);

create or replace function public.create_email_prospecting_sequence(
  p_organization_id uuid, p_name text, p_subject text, p_body_text text,
  p_followup1_body text, p_followup2_body text, p_lead_ids uuid[],
  p_followup1_day integer default 4, p_followup2_day integer default 8
)
returns table(campaign_id uuid, recipient_count integer)
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_connection public.email_connections%rowtype;
  v_campaign_id uuid;
  v_requested integer;
  v_eligible integer;
  v_inserted integer;
  v_processor_secret text;
begin
  if auth.uid() is null or not private.has_org_role(p_organization_id,array['member','admin','owner']::text[]) then
    raise exception 'Sem permissão para iniciar prospecção por e-mail.' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_name,'')))=0
     or length(btrim(coalesce(p_subject,'')))=0
     or length(btrim(coalesce(p_body_text,'')))=0
     or length(btrim(coalesce(p_followup1_body,'')))=0
     or length(btrim(coalesce(p_followup2_body,'')))=0 then
    raise exception 'Nome, assunto e as três mensagens da sequência são obrigatórios.';
  end if;
  if p_followup1_day is null or p_followup2_day is null
     or p_followup1_day < 2 or p_followup1_day > 30
     or p_followup2_day <= p_followup1_day or p_followup2_day > 60 then
    raise exception 'Dias inválidos: o 2º contato deve ser do dia 2 ao 30 e o 3º contato deve ser depois do 2º (até o dia 60).';
  end if;

  select * into v_connection
  from public.email_connections
  where organization_id=p_organization_id
    and status='connected'
    and provider in ('gmail','resend');

  if not found then
    raise exception 'Conecte uma conta Gmail ou Resend para usar a prospecção automática.';
  end if;

  v_requested:=coalesce((select count(distinct x) from unnest(coalesce(p_lead_ids,'{}'::uuid[])) x),0);
  if v_requested=0 then raise exception 'Selecione pelo menos um lead.'; end if;

  select count(*) into v_eligible
  from public.leads l
  where l.organization_id=p_organization_id
    and l.id=any(coalesce(p_lead_ids,'{}'::uuid[]))
    and l.deleted_at is null
    and l.email is not null
    and btrim(l.email)<>''
    and coalesce(l.email_marketing_opt_out,false)=false;

  if v_eligible<>v_requested then
    raise exception 'Um ou mais contatos não possuem e-mail válido, foram removidos ou cancelaram o recebimento.';
  end if;

  insert into public.email_campaigns(
    organization_id,name,subject,body_text,followup1_body,followup2_body,
    provider,from_email,from_name,status,total_recipients,scheduled_at,
    created_by,sequence_mode,prospecting_basis_confirmed_at,prospecting_basis_confirmed_by,
    followup1_day,followup2_day
  )
  values(
    p_organization_id,btrim(p_name),btrim(p_subject),p_body_text,p_followup1_body,p_followup2_body,
    v_connection.provider,
    coalesce(nullif(btrim(v_connection.sender_email),''),v_connection.email_address),
    v_connection.sender_name,'queued',0,now(),
    auth.uid(),true,now(),auth.uid(),
    p_followup1_day,p_followup2_day
  )
  returning id into v_campaign_id;

  insert into public.email_campaign_recipients(
    organization_id,campaign_id,lead_id,recipient_source,recipient_email,recipient_name,
    status,queued_at,next_attempt_at,sequence_step
  )
  select p_organization_id,v_campaign_id,l.id,'crm_prospecting',btrim(l.email),
         coalesce(nullif(btrim(l.contact_name),''),l.business_name),
         'queued',now(),now(),1
  from public.leads l
  where l.organization_id=p_organization_id
    and l.id=any(coalesce(p_lead_ids,'{}'::uuid[]))
    and l.deleted_at is null
    and l.email is not null
    and btrim(l.email)<>''
    and coalesce(l.email_marketing_opt_out,false)=false;

  get diagnostics v_inserted=row_count;
  update public.email_campaigns set total_recipients=v_inserted where id=v_campaign_id;

  begin
    v_processor_secret:=public.email_get_processor_secret();
    if v_processor_secret is not null and v_processor_secret<>'' then
      perform net.http_post(
        url:='https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/email-sequence-processor',
        body:=jsonb_build_object('campaign_id',v_campaign_id),
        headers:=jsonb_build_object('Content-Type','application/json','X-Processor-Secret',v_processor_secret),
        timeout_milliseconds:=60000
      );
    end if;
  exception when others then
    raise warning 'Falha ao acionar sequência imediatamente; o cron processará a fila.';
  end;

  return query select v_campaign_id,v_inserted;
end;
$function$;

revoke all on function public.create_email_prospecting_sequence(uuid,text,text,text,text,text,uuid[],integer,integer) from public, anon;
grant execute on function public.create_email_prospecting_sequence(uuid,text,text,text,text,text,uuid[],integer,integer) to authenticated, service_role;

create or replace function public.email_complete_recipient(
  p_recipient_id uuid, p_success boolean, p_provider_message_id text, p_error text,
  p_retry_after_seconds integer default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_campaign uuid;
  v_org uuid;
  v_sequence boolean;
  v_step smallint;
  v_replied_at timestamptz;
  v_f1 smallint;
  v_f2 smallint;
  v_remaining integer;
  v_failed integer;
  v_sent integer;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'service_role only' using errcode='42501';
  end if;

  select r.campaign_id,r.organization_id,c.sequence_mode,r.sequence_step,r.replied_at,c.followup1_day,c.followup2_day
    into v_campaign,v_org,v_sequence,v_step,v_replied_at,v_f1,v_f2
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
      update public.email_campaign_recipients
         set status='queued',
             sequence_step=v_step+1,
             provider_message_id=coalesce(p_provider_message_id,provider_message_id),
             error_message=null,
             sent_at=coalesce(sent_at,now()),
             next_attempt_at=now()+make_interval(days=>case when v_step=1 then greatest(v_f1-1,1) else greatest(v_f2-v_f1,1) end),
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
