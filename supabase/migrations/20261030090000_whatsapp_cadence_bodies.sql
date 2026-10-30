-- Cadência de WhatsApp: texto do follow-up escrito direto na cadência (como na prospecção por e-mail).
alter table public.whatsapp_cadences add column if not exists step1_body text;
alter table public.whatsapp_cadences add column if not exists step2_body text;

create or replace function private.run_whatsapp_cadence(p_dry_run boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  c record;
  s record;
  v_sender record;
  v_cand record;
  v_used integer;
  v_limit integer;
  v_budget integer;
  v_now_local timestamp := (now() at time zone 'America/Sao_Paulo');
  v_batch uuid;
  v_total integer := 0;
  v_template_id uuid;
  v_body text;
  v_phone text;
  v_in_window boolean;
begin
  for c in
    select wc.* from public.whatsapp_cadences wc
    join public.organizations o on o.id = wc.organization_id
    where wc.enabled and (wc.step1_template_id is not null or nullif(btrim(coalesce(wc.step1_body,'')),'') is not null) and o.is_active = true and o.deleted_at is null
  loop
    select * into s from public.organization_settings where organization_id = c.organization_id;
    if not found or coalesce(s.whatsapp_sending_paused, false) then continue; end if;

    -- dia e horário permitidos (evita acumular fila fora da janela)
    if s.default_cadence_days is not null and cardinality(s.default_cadence_days) > 0
       and not (extract(isodow from v_now_local)::smallint = any(s.default_cadence_days)) then continue; end if;
    v_in_window := true;
    if s.allowed_send_start is not null and s.allowed_send_end is not null then
      v_in_window := case when s.allowed_send_start <= s.allowed_send_end
        then v_now_local::time between s.allowed_send_start and s.allowed_send_end
        else v_now_local::time >= s.allowed_send_start or v_now_local::time <= s.allowed_send_end end;
    end if;
    if not v_in_window then continue; end if;

    select * into v_sender from public.whatsapp_numbers
      where organization_id = c.organization_id and is_active and is_default
        and connection_status = 'connected' and evolution_instance_name is not null limit 1;
    if not found then continue; end if;

    v_limit := coalesce(s.whatsapp_daily_send_limit, 20);
    select count(*) into v_used from public.outbound_messages om
      where om.organization_id = c.organization_id
        and ((om.status = 'sent' and (om.sent_at at time zone 'America/Sao_Paulo')::date = v_now_local::date)
             or om.status in ('queued','ready'));
    v_budget := least(3, v_limit - v_used);
    if v_budget <= 0 then continue; end if;

    for v_cand in
      select l.id, l.business_name, l.city, l.state, l.segment, l.email, l.phone, l.whatsapp_phone,
             st.n_sent, st.last_sent
      from public.leads l
      cross join lateral (
        select count(*)::int n_sent, max(om.sent_at) last_sent
        from public.outbound_messages om
        where om.lead_id = l.id and om.organization_id = l.organization_id and om.channel = 'whatsapp' and om.status = 'sent'
      ) st
      where l.organization_id = c.organization_id
        and l.target_segment_id = c.target_segment_id
        and l.deleted_at is null
        and l.status in ('contacted_pending','contacted')
        and coalesce(nullif(regexp_replace(coalesce(l.phone,''), '\D', '', 'g'), ''), '') <> ''
        and st.n_sent >= 1
        and st.n_sent <= case when (c.step2_template_id is not null or nullif(btrim(coalesce(c.step2_body,'')),'') is not null) then 2 else 1 end
        and st.last_sent <= now() - make_interval(days => case when st.n_sent = 1 then c.step1_delay_days else c.step2_delay_days end)
        and not exists (select 1 from public.outbound_messages x where x.lead_id = l.id and x.organization_id = l.organization_id and x.status in ('queued','ready'))
        and not exists (select 1 from public.outbound_messages x where x.lead_id = l.id and x.organization_id = l.organization_id and x.status = 'failed' and x.created_at > st.last_sent)
        and not exists (select 1 from public.whatsapp_messages wm where wm.lead_id = l.id and wm.organization_id = l.organization_id and wm.direction = 'inbound')
      order by st.last_sent asc
      limit v_budget
    loop
      v_template_id := case when v_cand.n_sent = 1 then c.step1_template_id else c.step2_template_id end;
      v_body := nullif(btrim(coalesce(case when v_cand.n_sent = 1 then c.step1_body else c.step2_body end, '')), '');
      if v_body is null and v_template_id is not null then
        select body into v_body from public.message_templates
          where id = v_template_id and organization_id = c.organization_id and is_active and deleted_at is null;
      end if;
      if v_body is null then continue; end if;
      v_phone := regexp_replace(coalesce(v_cand.phone,''), '\D', '', 'g');
      if v_phone not like '55%' then v_phone := '55' || v_phone; end if;
      v_body := replace(replace(replace(replace(replace(replace(v_body,
        '{empresa}', coalesce(v_cand.business_name,'')), '{cidade}', coalesce(v_cand.city,'')),
        '{uf}', coalesce(v_cand.state,'')), '{telefone}', coalesce(v_cand.whatsapp_phone, v_cand.phone, '')),
        '{segmento}', coalesce(v_cand.segment,'')), '{email}', coalesce(v_cand.email,''));

      if p_dry_run then v_total := v_total + 1; continue; end if;

      insert into public.outbound_batches (organization_id, target_segment_id, whatsapp_number_id, name, channel, status,
          total_recipients, interval_seconds, scheduled_start_at)
        values (c.organization_id, c.target_segment_id, v_sender.id, 'Cadência automática – ' || coalesce(v_cand.business_name,''),
          'whatsapp', 'queued', 1, greatest(1, coalesce(s.whatsapp_send_interval_seconds, 120)), now())
        returning id into v_batch;
      insert into public.outbound_messages (organization_id, batch_id, lead_id, template_id, whatsapp_number_id, channel,
          recipient, rendered_message, status, queued_at, scheduled_for)
        values (c.organization_id, v_batch, v_cand.id, v_template_id, v_sender.id, 'whatsapp',
          v_phone, v_body, 'queued', now(), now());
      insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
        values (c.organization_id, null, 'whatsapp_cadence_followup_queued', 'lead', v_cand.id,
          jsonb_build_object('step', v_cand.n_sent, 'template_id', v_template_id, 'batch_id', v_batch));
      v_total := v_total + 1;
    end loop;
  end loop;
  return v_total;
end;
$fn$;


revoke all on function private.run_whatsapp_cadence(boolean) from public, anon, authenticated;
