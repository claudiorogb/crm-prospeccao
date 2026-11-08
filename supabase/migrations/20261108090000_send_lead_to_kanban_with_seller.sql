-- Envio manual ao Kanban com definição atômica do vendedor responsável.
-- Reutiliza o campo leads.assigned_to e a validação de associação ativa à organização.
-- Não altera colunas, RLS, policies ou a função existente de entrada de clientes contactados.

create or replace function public.send_lead_to_kanban_with_seller(
  p_organization_id uuid,
  p_lead_id uuid,
  p_target_status text,
  p_assigned_to uuid
)
returns table(
  lead_id uuid,
  previous_status text,
  new_status text,
  status_changed_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_lead public.leads%rowtype;
  v_previous text;
begin
  if auth.uid() is null or not private.is_active_org_member(p_organization_id) then
    raise exception 'Sem permissão para enviar este lead ao Kanban.' using errcode = '42501';
  end if;

  if p_target_status not in ('new', 'contacted') then
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

  if v_lead.status in ('lost', 'not_interested', 'discarded') then
    raise exception 'Este registro não pode ser enviado ao Kanban a partir desta lista.';
  end if;

  v_previous := v_lead.status;

  update public.leads
     set status = p_target_status,
         assigned_to = p_assigned_to,
         updated_at = now()
   where id = p_lead_id
     and organization_id = p_organization_id;

  return query
  select l.id, v_previous, l.status, l.status_changed_at
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = p_organization_id;
end;
$function$;

revoke all on function public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid) from public;
revoke execute on function public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid) from anon;
grant execute on function public.send_lead_to_kanban_with_seller(uuid, uuid, text, uuid) to authenticated;
