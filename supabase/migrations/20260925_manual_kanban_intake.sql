-- Manual intake before the sales Kanban.
-- New captured leads and successful WhatsApp contacts remain outside the funnel
-- until a user explicitly sends them to the Kanban.

alter table public.leads
  drop constraint if exists leads_status_check;

alter table public.leads
  add constraint leads_status_check
  check (
    status = any (
      array[
        'new'::text,
        'queued'::text,
        'contacted'::text,
        'replied'::text,
        'interested'::text,
        'proposal'::text,
        'negotiation'::text,
        'not_interested'::text,
        'won'::text,
        'lost'::text,
        'discarded'::text,
        'captured_pending'::text,
        'contacted_pending'::text
      ]
    )
  );

create or replace function public.move_intake_lead_to_kanban(
  p_organization_id uuid,
  p_lead_id uuid,
  p_target_status text
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
    raise exception 'Sem permissão para mover este lead para o Kanban.' using errcode = '42501';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id
    and organization_id = p_organization_id
    and deleted_at is null
  for update;

  if v_lead.id is null then
    raise exception 'Lead não encontrado.';
  end if;

  v_previous := v_lead.status;

  if v_previous = 'captured_pending' and p_target_status not in ('new', 'contacted') then
    raise exception 'Lead captado só pode entrar no Kanban como Novo ou Contatado.';
  elsif v_previous = 'contacted_pending' and p_target_status <> 'replied' then
    raise exception 'Cliente contactado só pode entrar no Kanban como Respondeu.';
  elsif v_previous not in ('captured_pending', 'contacted_pending') then
    raise exception 'Este lead não está aguardando envio manual para o Kanban.';
  end if;

  update public.leads
     set status = p_target_status,
         updated_at = now()
   where id = p_lead_id
     and organization_id = p_organization_id;

  return query
  select l.id, v_previous, l.status, l.status_changed_at
  from public.leads l
  where l.id = p_lead_id;
end;
$function$;

revoke all on function public.move_intake_lead_to_kanban(uuid, uuid, text) from public;
revoke execute on function public.move_intake_lead_to_kanban(uuid, uuid, text) from anon;
grant execute on function public.move_intake_lead_to_kanban(uuid, uuid, text) to authenticated;
