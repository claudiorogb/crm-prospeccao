-- Listas de leads e clientes: leads de qualquer origem (Google, manual, importação) podem ir para clientes.
-- A volta para prospecção continua restrita a contatos importados sem vendas, contrato nem histórico.
create or replace function public.move_import_leads(p_lead_ids uuid[], p_target text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_lead public.leads%rowtype;
  v_moved integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessao invalida.' using errcode='42501';
  end if;
  if p_target not in ('customers','prospects') then
    raise exception 'Destino invalido.' using errcode='22023';
  end if;
  if p_lead_ids is null or coalesce(array_length(p_lead_ids,1),0) = 0 then
    raise exception 'Selecione ao menos um contato.' using errcode='22023';
  end if;
  if array_length(p_lead_ids,1) > 1000 then
    raise exception 'Selecione no maximo 1000 contatos por vez.' using errcode='22023';
  end if;

  for v_lead in
    select * from public.leads l
    where l.id = any(p_lead_ids) and l.deleted_at is null
    order by l.id
    for update
  loop
    if not ((select private.is_system_admin()) or
            (select private.has_org_role(v_lead.organization_id, array['owner','admin']))) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_target = 'customers' then
      if v_lead.status in ('won','lost','interested','proposal') then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      update public.leads set status = 'won', updated_at = now() where id = v_lead.id;
      v_moved := v_moved + 1;
    else
      if v_lead.source <> 'import'
         or v_lead.status <> 'won'
         or coalesce(v_lead.contract_value, 0) > 0
         or exists (select 1 from public.sales s where s.lead_id = v_lead.id and s.deleted_at is null)
         or exists (select 1 from public.activities a where a.lead_id = v_lead.id) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      perform set_config('app.lead_status_reason', 'import_list_move', true);
      update public.leads set status = 'new', updated_at = now() where id = v_lead.id;
      perform set_config('app.lead_status_reason', '', true);
      v_moved := v_moved + 1;
    end if;
  end loop;

  v_skipped := v_skipped + greatest(array_length(p_lead_ids,1) - v_moved - v_skipped, 0);
  return jsonb_build_object('moved', v_moved, 'skipped', v_skipped);
end;
$function$;

-- Última mensagem enviada por canal (só leitura; segue as regras de acesso de quem consulta).
create or replace function public.lead_last_messages(p_lead_ids uuid[])
 returns table(lead_id uuid, whatsapp_at timestamptz, email_at timestamptz, marketing_at timestamptz)
 language sql
 stable
 set search_path to 'pg_catalog', 'public'
as $function$
  select l.id,
    greatest(
      (select max(m.sent_at) from public.outbound_messages m where m.lead_id = l.id and m.status = 'sent'),
      (select max(w.occurred_at) from public.whatsapp_messages w where w.lead_id = l.id and w.direction = 'outbound' and w.deleted_at is null)
    ),
    (select max(r.sent_at) from public.email_campaign_recipients r where r.lead_id = l.id and r.recipient_source = 'crm_prospecting' and r.sent_at is not null),
    (select max(r.sent_at) from public.email_campaign_recipients r where r.lead_id = l.id and r.recipient_source = 'crm_client' and r.sent_at is not null)
  from public.leads l
  where l.id = any((p_lead_ids)[1:1000]) and l.deleted_at is null
$function$;

revoke all on function public.lead_last_messages(uuid[]) from public, anon;
grant execute on function public.lead_last_messages(uuid[]) to authenticated, service_role;
