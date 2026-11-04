-- Importação com destino (lista de clientes ou lista de prospecção) e movimentação entre as duas listas.
-- Nada muda para quem importa como antes: o destino padrão continua sendo "customers".

alter table public.customer_import_batches
  add column if not exists destination text not null default 'customers';
alter table public.customer_import_batches
  drop constraint if exists customer_import_batches_destination_check;
alter table public.customer_import_batches
  add constraint customer_import_batches_destination_check check (destination in ('customers','prospects'));

-- Análise: no destino "prospects" qualquer cadastro já existente vira duplicado (nunca é alterado).
CREATE OR REPLACE FUNCTION public.analyze_customer_import(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_batch public.customer_import_batches%rowtype;
  v_row public.customer_import_rows%rowtype;
  v_match uuid;
  v_match_status text;
  v_match_count integer;
  v_customer_row public.customer_import_rows%rowtype;
  v_business_name text;
  v_tax_id text;
  v_phone text;
  v_whatsapp text;
  v_email text;
  v_state text;
  v_key text;
  v_amount numeric;
  v_date date;
  v_valid integer;
  v_duplicates integer;
  v_invalid integer;
begin
  select * into v_batch
  from public.customer_import_batches
  where id = p_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Importacao nao encontrada.' using errcode = 'P0002';
  end if;
  if not ((select private.is_system_admin()) or
          (select private.has_org_role(v_batch.organization_id, array['owner','admin']))) then
    raise exception 'Somente administradores da empresa podem importar clientes.' using errcode = '42501';
  end if;
  if v_batch.status not in ('uploaded','analyzed') then
    raise exception 'Esta importacao nao pode mais ser analisada.' using errcode = '55000';
  end if;

  update public.customer_import_rows
     set status = 'pending', error_code = null, error_message = null,
         matched_lead_id = null, processed_at = null
   where batch_id = p_batch_id;

  for v_row in
    select * from public.customer_import_rows
    where batch_id = p_batch_id and row_type = 'customer'
    order by row_number
  loop
    v_business_name := btrim(coalesce(v_row.normalized_data->>'business_name',''));
    v_tax_id := regexp_replace(coalesce(v_row.normalized_data->>'tax_id',''), '\D', '', 'g');
    v_phone := regexp_replace(coalesce(v_row.normalized_data->>'phone',''), '\D', '', 'g');
    v_whatsapp := regexp_replace(coalesce(v_row.normalized_data->>'whatsapp_phone',''), '\D', '', 'g');
    v_email := lower(btrim(coalesce(v_row.normalized_data->>'email','')));
    v_state := upper(btrim(coalesce(v_row.normalized_data->>'state','')));
    v_key := btrim(coalesce(v_row.normalized_data->>'customer_key',''));

    if v_business_name = '' then
      update public.customer_import_rows set status='invalid', error_code='missing_business_name',
        error_message='Empresa / Cliente e obrigatorio.' where id=v_row.id;
      continue;
    elsif v_tax_id <> '' and char_length(v_tax_id) not in (11,14) then
      update public.customer_import_rows set status='invalid', error_code='invalid_tax_id',
        error_message='CNPJ / CPF deve ter 11 ou 14 digitos.' where id=v_row.id;
      continue;
    elsif v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      update public.customer_import_rows set status='invalid', error_code='invalid_email',
        error_message='E-mail invalido.' where id=v_row.id;
      continue;
    elsif v_state <> '' and v_state !~ '^[A-Z]{2}$' then
      update public.customer_import_rows set status='invalid', error_code='invalid_state',
        error_message='UF deve conter duas letras.' where id=v_row.id;
      continue;
    end if;

    select count(*) into v_match_count
    from public.customer_import_rows r
    where r.batch_id=p_batch_id and r.row_type='customer'
      and r.normalized_data->>'customer_key'=v_key;
    if v_key='' or v_match_count > 1 then
      update public.customer_import_rows set status='invalid', error_code='duplicate_in_file',
        error_message='O mesmo cliente aparece mais de uma vez na aba Clientes.' where id=v_row.id;
      continue;
    end if;

    select count(*), (array_agg(l.id order by l.id))[1], (array_agg(l.status order by l.id))[1]
      into v_match_count, v_match, v_match_status
    from public.leads l
    where l.organization_id = v_batch.organization_id
      and l.deleted_at is null
      and (
        (v_tax_id <> '' and regexp_replace(coalesce(l.cnpj,''), '\D', '', 'g') = v_tax_id)
        or (v_email <> '' and lower(btrim(coalesce(l.email,''))) = v_email)
        or (v_whatsapp <> '' and regexp_replace(coalesce(l.whatsapp_phone,''), '\D', '', 'g') = v_whatsapp)
        or (v_phone <> '' and regexp_replace(coalesce(l.phone,''), '\D', '', 'g') = v_phone)
      );

    if v_batch.destination = 'prospects' and v_match_count >= 1 then
      update public.customer_import_rows set status='duplicate', matched_lead_id=v_match where id=v_row.id;
    elsif v_match_count > 1 then
      update public.customer_import_rows set status='invalid', error_code='ambiguous_duplicate',
        error_message='Mais de um cadastro existente corresponde a esta linha; revise CNPJ, telefone e e-mail.'
        where id=v_row.id;
    elsif v_match_count = 1 and v_match_status <> 'won' then
      update public.customer_import_rows set status='invalid', error_code='existing_lead', matched_lead_id=v_match,
        error_message='Este cadastro ja existe no funil e precisa ser convertido manualmente antes da importacao.'
        where id=v_row.id;
    elsif v_match_count = 1 then
      update public.customer_import_rows set status='duplicate', matched_lead_id=v_match where id=v_row.id;
    else
      update public.customer_import_rows set status='valid' where id=v_row.id;
    end if;
  end loop;

  -- Historico e vendas precisam apontar para exatamente um cliente da aba Clientes.
  for v_row in
    select * from public.customer_import_rows
    where batch_id = p_batch_id and row_type in ('activity','sale')
    order by row_type, row_number
  loop
    v_key := btrim(coalesce(v_row.normalized_data->>'customer_key',''));
    if v_key = '' then
      update public.customer_import_rows set status='invalid', error_code='missing_customer_key',
        error_message='Informe CNPJ / CPF ou Empresa / Cliente para relacionar este registro.' where id=v_row.id;
      continue;
    end if;

    select * into v_customer_row
    from public.customer_import_rows r
    where r.batch_id=p_batch_id and r.row_type='customer'
      and r.normalized_data->>'customer_key'=v_key
    order by r.row_number
    limit 1;

    if v_customer_row.id is null then
      update public.customer_import_rows set status='invalid', error_code='customer_not_in_file',
        error_message='Cliente nao encontrado na aba Clientes.' where id=v_row.id;
      continue;
    elsif v_customer_row.status='invalid' then
      update public.customer_import_rows set status='invalid', error_code='invalid_customer_reference',
        error_message='O cadastro do cliente relacionado possui erro.' where id=v_row.id;
      continue;
    end if;

    if v_row.row_type='activity' then
      begin
        v_date := (v_row.normalized_data->>'occurred_on')::date;
      exception when others then
        update public.customer_import_rows set status='invalid', error_code='invalid_date',
          error_message='Data do contato invalida.' where id=v_row.id;
        continue;
      end;
      if btrim(coalesce(v_row.normalized_data->>'notes',''))='' then
        update public.customer_import_rows set status='invalid', error_code='missing_notes',
          error_message='Observacao do contato e obrigatoria.' where id=v_row.id;
        continue;
      end if;
    else
      begin
        v_date := (v_row.normalized_data->>'sale_date')::date;
        v_amount := (v_row.normalized_data->>'amount')::numeric;
      exception when others then
        update public.customer_import_rows set status='invalid', error_code='invalid_sale',
          error_message='Data ou valor da venda invalido.' where id=v_row.id;
        continue;
      end;
      if v_amount <= 0 then
        update public.customer_import_rows set status='invalid', error_code='invalid_amount',
          error_message='Valor da venda deve ser maior que zero.' where id=v_row.id;
        continue;
      end if;
    end if;

    update public.customer_import_rows set status='valid' where id=v_row.id;
  end loop;

  select count(*) filter (where status='valid'),
         count(*) filter (where status='duplicate'),
         count(*) filter (where status='invalid')
    into v_valid, v_duplicates, v_invalid
  from public.customer_import_rows where batch_id=p_batch_id;

  update public.customer_import_batches
     set status='analyzed',
         total_rows=(select count(*) from public.customer_import_rows where batch_id=p_batch_id),
         valid_rows=v_valid, duplicate_rows=v_duplicates, invalid_rows=v_invalid,
         analyzed_at=now()
   where id=p_batch_id;

  return jsonb_build_object('batch_id',p_batch_id,'valid',v_valid,'duplicates',v_duplicates,'invalid',v_invalid,
    'total',v_valid+v_duplicates+v_invalid);
end;
$function$;

-- Confirmação: destino "prospects" cria leads na etapa Novo (origem import), nunca altera cadastros existentes
-- e ignora histórico/vendas. Destino "customers" funciona exatamente como antes.
CREATE OR REPLACE FUNCTION public.commit_customer_import(p_batch_id uuid, p_duplicate_action text DEFAULT 'skip'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_batch public.customer_import_batches%rowtype;
  v_row public.customer_import_rows%rowtype;
  v_customer_row public.customer_import_rows%rowtype;
  v_lead_id uuid;
  v_data jsonb;
  v_type text;
  v_channel text;
  v_imported integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_prospects boolean;
begin
  if p_duplicate_action not in ('skip','update') then
    raise exception 'Acao de duplicidade invalida.' using errcode='22023';
  end if;
  select * into v_batch from public.customer_import_batches where id=p_batch_id for update;
  if v_batch.id is null then raise exception 'Importacao nao encontrada.' using errcode='P0002'; end if;
  if not ((select private.is_system_admin()) or
          (select private.has_org_role(v_batch.organization_id, array['owner','admin']))) then
    raise exception 'Somente administradores da empresa podem confirmar importacoes.' using errcode='42501';
  end if;
  if v_batch.status <> 'analyzed' then
    raise exception 'Analise a planilha antes de confirmar.' using errcode='55000';
  end if;
  v_prospects := (v_batch.destination = 'prospects');
  update public.customer_import_batches set status='processing',duplicate_action=p_duplicate_action where id=p_batch_id;

  for v_row in select * from public.customer_import_rows
    where batch_id=p_batch_id and row_type='customer' and status in ('valid','duplicate') order by row_number
  loop
    v_data := v_row.normalized_data;
    if v_row.status='duplicate' then
      v_lead_id := v_row.matched_lead_id;
      if p_duplicate_action='skip' or v_prospects then
        update public.customer_import_rows set status='skipped',processed_at=now() where id=v_row.id;
        v_skipped := v_skipped + 1;
      else
        update public.leads set
          business_name=coalesce(nullif(btrim(v_data->>'business_name'),''),business_name),
          legal_name=coalesce(nullif(btrim(v_data->>'legal_name'),''),legal_name),
          cnpj=coalesce(nullif(btrim(v_data->>'tax_id'),''),cnpj),
          segment=coalesce(nullif(btrim(v_data->>'segment'),''),segment),
          phone=coalesce(nullif(btrim(v_data->>'phone'),''),phone),
          whatsapp_phone=coalesce(nullif(btrim(v_data->>'whatsapp_phone'),''),whatsapp_phone),
          email=coalesce(nullif(lower(btrim(v_data->>'email')),''),email),
          contact_name=coalesce(nullif(btrim(v_data->>'contact_name'),''),contact_name),
          contact_role=coalesce(nullif(btrim(v_data->>'contact_role'),''),contact_role),
          address=coalesce(nullif(btrim(v_data->>'address'),''),address),
          city=coalesce(nullif(btrim(v_data->>'city'),''),city),
          state=coalesce(nullif(upper(btrim(v_data->>'state')),''),state),
          website=coalesce(nullif(btrim(v_data->>'website'),''),website),
          customer_origin=coalesce(nullif(btrim(v_data->>'customer_origin'),''),customer_origin),
          next_contact_date=coalesce(nullif(v_data->>'next_contact_date','')::date,next_contact_date),
          commercial_notes=coalesce(nullif(btrim(v_data->>'commercial_notes'),''),commercial_notes),
          updated_at=now()
        where id=v_lead_id and organization_id=v_batch.organization_id and status='won' and deleted_at is null;
        update public.customer_import_rows set status='updated',processed_at=now() where id=v_row.id;
        v_updated := v_updated + 1;
      end if;
    else
      insert into public.leads (
        organization_id,business_name,legal_name,cnpj,segment,phone,whatsapp_phone,email,
        contact_name,contact_role,address,city,state,website,customer_origin,next_contact_date,
        commercial_notes,status,source,captured_by,assigned_to,assigned_at
      ) values (
        v_batch.organization_id,btrim(v_data->>'business_name'),nullif(btrim(v_data->>'legal_name'),''),
        nullif(btrim(v_data->>'tax_id'),''),
        coalesce(nullif(btrim(v_data->>'segment'),''), case when v_prospects then 'Lista importada' else 'Cliente importado' end),
        nullif(btrim(v_data->>'phone'),''),nullif(btrim(v_data->>'whatsapp_phone'),''),
        nullif(lower(btrim(v_data->>'email')),''),nullif(btrim(v_data->>'contact_name'),''),
        nullif(btrim(v_data->>'contact_role'),''),nullif(btrim(v_data->>'address'),''),
        nullif(btrim(v_data->>'city'),''),nullif(upper(btrim(v_data->>'state')),''),
        nullif(btrim(v_data->>'website'),''),coalesce(nullif(btrim(v_data->>'customer_origin'),''),'Importacao'),
        nullif(v_data->>'next_contact_date','')::date,nullif(btrim(v_data->>'commercial_notes'),''),
        case when v_prospects then 'new' else 'won' end,'import',v_batch.requested_by,
        case when v_prospects then null else v_batch.requested_by end,
        case when v_prospects then null else now() end
      ) returning id into v_lead_id;
      update public.customer_import_rows set status='imported',matched_lead_id=v_lead_id,processed_at=now() where id=v_row.id;
      v_imported := v_imported + 1;
    end if;
  end loop;

  for v_row in select * from public.customer_import_rows
    where batch_id=p_batch_id and row_type in ('activity','sale') and status='valid' order by row_type,row_number
  loop
    if v_prospects then
      update public.customer_import_rows set status='skipped',error_code='prospect_list',
        error_message='Historico e vendas nao sao importados para a lista de prospeccao.',processed_at=now() where id=v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select * into v_customer_row from public.customer_import_rows r
    where r.batch_id=p_batch_id and r.row_type='customer'
      and r.normalized_data->>'customer_key'=v_row.normalized_data->>'customer_key'
      and r.matched_lead_id is not null order by r.row_number limit 1;
    if v_customer_row.matched_lead_id is null then
      update public.customer_import_rows set status='skipped',error_code='customer_not_imported',
        error_message='Registro ignorado porque o cliente relacionado nao foi importado.',processed_at=now() where id=v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_data := v_row.normalized_data;
    if v_row.row_type='activity' then
      v_type := case lower(coalesce(v_data->>'activity_type',''))
        when 'whatsapp' then 'whatsapp' when 'ligacao' then 'call' when 'call' then 'call'
        when 'email' then 'email' when 'reuniao' then 'meeting' when 'meeting' then 'meeting' else 'note' end;
      v_channel := case v_type when 'whatsapp' then 'whatsapp' when 'call' then 'phone' when 'email' then 'email' else 'other' end;
      insert into public.activities(organization_id,lead_id,activity_type,channel,notes,occurred_at,created_by)
      values(v_batch.organization_id,v_customer_row.matched_lead_id,v_type,v_channel,btrim(v_data->>'notes'),
        ((v_data->>'occurred_on')::date + time '12:00') at time zone 'America/Sao_Paulo',v_batch.requested_by);
    else
      insert into public.sales(organization_id,lead_id,sale_date,amount,product_service,notes,created_by,origin)
      values(v_batch.organization_id,v_customer_row.matched_lead_id,(v_data->>'sale_date')::date,
        (v_data->>'amount')::numeric,nullif(btrim(v_data->>'product_service'),''),
        nullif(btrim(v_data->>'notes'),''),v_batch.requested_by,'import');
    end if;
    update public.customer_import_rows set status='imported',matched_lead_id=v_customer_row.matched_lead_id,processed_at=now() where id=v_row.id;
    v_imported := v_imported + 1;
  end loop;

  update public.customer_import_batches set status='completed',duplicate_action=p_duplicate_action,
    imported_rows=v_imported,updated_rows=v_updated,skipped_rows=v_skipped,completed_at=now() where id=p_batch_id;
  return jsonb_build_object('batch_id',p_batch_id,'imported',v_imported,'updated',v_updated,
    'skipped',v_skipped,'invalid',v_batch.invalid_rows);
end;
$function$;

-- Regra de progressão: "ganho" continua terminal. Única exceção, fechada: a função de mover contatos
-- importados (executada pelo dono da função) devolve para "novo" um contato importado sem vendas/histórico.
CREATE OR REPLACE FUNCTION private.enforce_lead_status_progression()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.status is not distinct from old.status then return new; end if;

  if old.status = 'interested' and new.status not in ('proposal','lost') then
    raise exception 'Transição inválida a partir de Interessado';
  elsif old.status = 'proposal' and new.status not in ('negotiation','lost') then
    raise exception 'Transição inválida a partir de Proposta';
  elsif old.status = 'negotiation' and new.status not in ('won','lost') then
    raise exception 'Transição inválida a partir de Negociação';
  elsif old.status = 'won' then
    if new.status = 'new'
      and old.source = 'import'
      and current_user in ('postgres','supabase_admin')
      and current_setting('app.lead_status_reason', true) = 'import_list_move' then
      return new;
    end if;
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

-- Mover contatos importados entre a lista de prospecção e a lista de clientes (somente dono/administrador).
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
    where l.id = any(p_lead_ids) and l.deleted_at is null and l.source = 'import'
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
      if v_lead.status <> 'won'
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

revoke all on function public.move_import_leads(uuid[], text) from public, anon;
grant execute on function public.move_import_leads(uuid[], text) to authenticated, service_role;
