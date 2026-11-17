create or replace function public.mark_whatsapp_inbound_message_read(
  p_organization_id uuid,
  p_whatsapp_number_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_conversation_id uuid;
begin
  update public.whatsapp_messages
     set delivery_status = 'read'
   where organization_id = p_organization_id
     and whatsapp_number_id = p_whatsapp_number_id
     and provider = 'evolution'
     and provider_message_id = p_provider_message_id
     and direction = 'inbound'
     and deleted_at is null
     and delivery_status is distinct from 'read'
  returning conversation_id into v_conversation_id;

  if not found then
    return false;
  end if;

  update public.whatsapp_conversations
     set unread_count = greatest(unread_count - 1, 0),
         last_read_at = now(),
         updated_at = now()
   where id = v_conversation_id
     and organization_id = p_organization_id
     and whatsapp_number_id = p_whatsapp_number_id;

  if not found then
    raise exception 'WhatsApp conversation not found for inbound message';
  end if;

  return true;
end;
$function$;

revoke all on function public.mark_whatsapp_inbound_message_read(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_whatsapp_inbound_message_read(uuid, uuid, text) to service_role;