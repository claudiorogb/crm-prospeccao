-- Envio manual ao Kanban com definição atômica do vendedor responsável.
-- Reutiliza leads.assigned_to e os membros ativos da própria organização.
-- Não altera RLS, policies existentes, autenticação ou isolamento por organização.
-- A atribuição feita no Kanban é exclusiva de owner/admin também no banco.

drop function if exists public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid, text);

create or replace function public.send_lead_to_kanban_with_seller(
  p_organization_id uuid,
  p_lead_id uuid,
  p_target_status text,
  p_assigned_to uuid,
  p_expected_status text default null
)
returns table(
  lead_id uuid,
  previous_status text,
  new_status text,
  status_changed_at timestamptz,
  created_new_opportunity boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_lead public.leads%rowtype;
  v_previous text;
  v_target_id uuid;
  v_changed_at timestamptz;
  v_phone_digits text;
begin
  if auth.uid() is null or not private.is_active_org_member(p_organization_id) then
    raise exception 'Sem permissão para enviar este lead ao Kanban.' using errcode = '42501';
  end if;

  if p_target_status is null or p_target_status not in ('new', 'contacted') then
    raise exception 'A etapa escolhida precisa ser Novo ou Contatado.';
  end if;

  if p_assigned_to is null or not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_assigned_to
      and om.is_active = true
      and om.deleted_at is null
  ) then
    raise exception 'Selecione um vendedor ativo desta empresa.';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
    and organization_id = p_organization_id
    and deleted_at is null
  for update;

  if v_lead.id is null then
    raise exception 'Lead não encontrado nesta empresa.';
  end if;

  v_previous := v_lead.status;

  if p_expected_status is not null then
    if p_expected_status <> 'captured_pending' or v_previous <> p_expected_status then
      raise exception 'Este lead não está mais aguardando envio na lista de Leads captados.';
    end if;
  end if;

  -- Cliente com negócio ganho permanece como cliente; o Kanban recebe uma nova oportunidade.
  -- Isso preserva o histórico de venda e a regra existente de que "Ganho" é etapa terminal.
  if v_previous = 'won' then
    v_phone_digits := nullif(regexp_replace(coalesce(v_lead.phone, ''), '[^0-9]', '', 'g'), '');

    if exists (
      select 1
      from public.leads existing
      where existing.organization_id = p_organization_id
        and existing.deleted_at is null
        and existing.status not in ('won', 'lost', 'not_interested', 'discarded')
        and lower(btrim(existing.business_name)) = lower(btrim(v_lead.business_name))
        and (
          v_phone_digits is null
          or nullif(regexp_replace(coalesce(existing.phone, ''), '[^0-9]', '', 'g'), '') = v_phone_digits
        )
    ) then
      raise exception 'Já existe uma oportunidade ativa para este cliente no Kanban.';
    end if;

    insert into public.leads as inserted_lead (
      organization_id,
      business_name,
      segment,
      target_segment_id,
      customer_origin,
      contact_name,
      phone,
      website,
      email,
      address,
      city,
      state,
      capture_notes,
      captured_by,
      assigned_to,
      status,
      source
    ) values (
      p_organization_id,
      v_lead.business_name,
      coalesce(nullif(btrim(v_lead.segment), ''), 'Cliente existente'),
      v_lead.target_segment_id,
      coalesce(nullif(btrim(v_lead.customer_origin), ''), 'Base de clientes'),
      v_lead.contact_name,
      v_lead.phone,
      v_lead.website,
      v_lead.email,
      v_lead.address,
      v_lead.city,
      v_lead.state,
      concat_ws(E'\n\n', nullif(btrim(v_lead.capture_notes), ''), 'Nova oportunidade criada a partir de um cadastro de cliente.'),
      auth.uid(),
      p_assigned_to,
      p_target_status,
      'other'
    )
    returning inserted_lead.id, inserted_lead.status_changed_at into v_target_id, v_changed_at;

    return query
    select v_target_id, v_previous, p_target_status, v_changed_at, true;
    return;
  end if;

  if v_previous in ('lost', 'not_interested', 'discarded') then
    raise exception 'Este registro não pode ser enviado ao Kanban a partir desta lista.';
  end if;

  if v_previous in ('interested', 'proposal', 'negotiation') then
    raise exception 'Este lead já está em uma etapa avançada do funil. A etapa atual foi preservada.';
  end if;

  -- Usuários comuns só podem atribuir o vendedor ao encaminhar uma captação
  -- que ainda não entrou no Kanban. Leads já presentes no funil exigem admin.
  if v_previous <> 'captured_pending'
     and not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception 'Este lead já está no funil ou não está aguardando envio. Somente o proprietário ou administrador pode alterar o responsável.';
  end if;

  update public.leads as updated_lead
     set status = p_target_status,
         assigned_to = p_assigned_to,
         updated_at = now()
   where updated_lead.id = p_lead_id
     and updated_lead.organization_id = p_organization_id
  returning updated_lead.status_changed_at into v_changed_at;

  return query
  select v_lead.id, v_previous, p_target_status, v_changed_at, false;
end;
$function$;

revoke all on function public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid, text) from public;
revoke execute on function public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid, text) from anon;
grant execute on function public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid, text) to authenticated;


-- Protege mudanças diretas em assigned_to feitas pela API.
-- A função é SECURITY INVOKER: current_user continua sendo authenticated/anon
-- nas atualizações diretas do navegador. Funções internas SECURITY DEFINER
-- só podem passar por esta barreira depois de validar sua própria autorização.
create or replace function private.guard_lead_seller_reassignment()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'private'
as $function$
begin
  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is not null and not exists (
      select 1
      from public.organization_members om
      where om.organization_id = new.organization_id
        and om.user_id = new.assigned_to
        and om.is_active = true
        and om.deleted_at is null
    ) then
      raise exception 'O vendedor precisa ser um usuário ativo desta empresa.';
    end if;

    if current_user in ('authenticated', 'anon')
       and not private.has_org_role(new.organization_id, array['owner', 'admin']::text[]) then
      raise exception 'Somente o proprietário ou administrador da empresa pode alterar o vendedor responsável.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_lead_seller_reassignment on public.leads;
create trigger trg_guard_lead_seller_reassignment
before update of assigned_to on public.leads
for each row
execute function private.guard_lead_seller_reassignment();


-- Endpoint usado pelo Kanban para trocar ou remover o vendedor.
-- Owner/admin é verificado no banco, não apenas na interface.
create or replace function public.admin_assign_lead_seller(
  p_organization_id uuid,
  p_lead_id uuid,
  p_assigned_to uuid
)
returns table(
  lead_id uuid,
  assigned_to uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_lead_id uuid;
begin
  if auth.uid() is null
     or not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception 'Somente o proprietário ou administrador da empresa pode alterar o vendedor responsável.'
      using errcode = '42501';
  end if;

  if p_assigned_to is not null and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_assigned_to
      and om.is_active = true
      and om.deleted_at is null
  ) then
    raise exception 'O vendedor precisa ser um usuário ativo desta empresa.';
  end if;

  select l.id
    into v_lead_id
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = p_organization_id
    and l.deleted_at is null
  for update;

  if v_lead_id is null then
    raise exception 'Lead não encontrado nesta empresa.';
  end if;

  update public.leads
     set assigned_to = p_assigned_to,
         updated_at = now()
   where id = v_lead_id
     and organization_id = p_organization_id;

  return query select v_lead_id, p_assigned_to;
end;
$function$;

revoke all on function public.admin_assign_lead_seller(uuid, uuid, uuid) from public;
revoke execute on function public.admin_assign_lead_seller(uuid, uuid, uuid) from anon;
grant execute on function public.admin_assign_lead_seller(uuid, uuid, uuid) to authenticated;
