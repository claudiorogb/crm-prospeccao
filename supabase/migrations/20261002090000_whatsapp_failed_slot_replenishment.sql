-- Reposição automática de vaga diária do WhatsApp.
-- Uma falha não consome a cota diária: a próxima mensagem da fila ocupa a vaga liberada.

create or replace function public.replenish_whatsapp_daily_slot(
  p_organization_id uuid,
  p_whatsapp_number_id uuid,
  p_interval_seconds integer default 120
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_scheduled timestamptz;
  v_now timestamptz := now();
  v_local date := (v_now at time zone 'America/Sao_Paulo')::date;
  v_local_time time := (v_now at time zone 'America/Sao_Paulo')::time;
  v_start time;
  v_end time;
  v_limit integer;
  v_allowed_days smallint[];
  v_last_sent timestamptz;
  v_last_scheduled timestamptz;
  v_daily_sent integer;
begin
  if not pg_try_advisory_xact_lock(732941) then
    return null;
  end if;

  select
    coalesce(os.whatsapp_daily_send_limit, 20),
    coalesce(os.allowed_send_start, '08:00'::time),
    coalesce(os.allowed_send_end, '18:00'::time),
    coalesce(os.default_cadence_days, array[1,3,5]::smallint[])
  into v_limit, v_start, v_end, v_allowed_days
  from public.organization_settings os
  where os.organization_id = p_organization_id;

  if not found then
    return null;
  end if;

  if extract(isodow from v_local)::smallint <> all(v_allowed_days) then
    return null;
  end if;

  if v_local_time < v_start or v_local_time > v_end then
    return null;
  end if;

  select count(*) into v_daily_sent
  from public.outbound_messages sent
  where sent.organization_id = p_organization_id
    and sent.status = 'sent'
    and sent.sent_at is not null
    and (sent.sent_at at time zone 'America/Sao_Paulo')::date = v_local;

  if v_daily_sent >= v_limit then
    return null;
  end if;

  select max(sent.sent_at)
  into v_last_sent
  from public.outbound_messages sent
  where sent.organization_id = p_organization_id
    and sent.status = 'sent'
    and sent.sent_at is not null
    and (sent.sent_at at time zone 'America/Sao_Paulo')::date = v_local
    and sent.whatsapp_number_id = p_whatsapp_number_id;

  select max(om.scheduled_for)
  into v_last_scheduled
  from public.outbound_messages om
  where om.organization_id = p_organization_id
    and om.whatsapp_number_id = p_whatsapp_number_id
    and om.status in ('queued','ready','processing')
    and om.scheduled_for is not null
    and (om.scheduled_for at time zone 'America/Sao_Paulo')::date = v_local;

  v_scheduled := greatest(
    v_now,
    coalesce(v_last_sent + make_interval(secs => greatest(1, p_interval_seconds)), v_now),
    coalesce(v_last_scheduled + make_interval(secs => greatest(1, p_interval_seconds)), v_now)
  );

  if (v_scheduled at time zone 'America/Sao_Paulo')::time < v_start then
    v_scheduled := v_local::timestamp at time zone 'America/Sao_Paulo' + v_start;
  end if;

  if (v_scheduled at time zone 'America/Sao_Paulo')::date <> v_local
     or (v_scheduled at time zone 'America/Sao_Paulo')::time > v_end then
    return null;
  end if;

  select om.id into v_message_id
  from public.outbound_messages om
  join public.outbound_batches ob on ob.id = om.batch_id
  where om.organization_id = p_organization_id
    and om.whatsapp_number_id = p_whatsapp_number_id
    and om.status = 'queued'
    and om.scheduled_for > v_now
    and ob.status in ('queued','ready','in_progress')
  order by om.scheduled_for asc, om.created_at asc
  for update of om skip locked
  limit 1;

  if v_message_id is null then
    return null;
  end if;

  update public.outbound_messages
  set scheduled_for = v_scheduled,
      error_message = null,
      updated_at = v_now
  where id = v_message_id
    and status = 'queued';

  return v_message_id;
end;
$$;
