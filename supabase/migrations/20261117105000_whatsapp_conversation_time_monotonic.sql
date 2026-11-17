-- Evita que eventos WhatsApp entregues fora de ordem façam a conversa retroceder.
-- A função é SECURITY INVOKER (padrão): não altera RLS nem amplia privilégios.

create or replace function private.prevent_whatsapp_conversation_time_regression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.last_message_at is not null
     and (new.last_message_at is null or new.last_message_at < old.last_message_at) then
    new.last_message_at := old.last_message_at;
    new.last_message_preview := old.last_message_preview;
  end if;

  if old.last_inbound_at is not null
     and (new.last_inbound_at is null or new.last_inbound_at < old.last_inbound_at) then
    new.last_inbound_at := old.last_inbound_at;
  end if;

  if old.last_outbound_at is not null
     and (new.last_outbound_at is null or new.last_outbound_at < old.last_outbound_at) then
    new.last_outbound_at := old.last_outbound_at;
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_whatsapp_conversation_time_regression()
  from public, anon, authenticated;

drop trigger if exists trg_whatsapp_conversation_time_monotonic
  on public.whatsapp_conversations;

create trigger trg_whatsapp_conversation_time_monotonic
before update of last_message_at, last_message_preview, last_inbound_at, last_outbound_at
on public.whatsapp_conversations
for each row
execute function private.prevent_whatsapp_conversation_time_regression();

-- Corrige apenas conversas em que uma mensagem gravada é mais recente que o
-- resumo da conversa. Nunca reduz datas e não reassocia leads/contatos.
with latest_message as (
  select distinct on (m.organization_id, m.conversation_id)
    m.organization_id,
    m.conversation_id,
    m.source,
    m.direction,
    m.message_type,
    m.text_body,
    m.occurred_at
  from public.whatsapp_messages m
  where m.deleted_at is null
  order by m.organization_id, m.conversation_id, m.occurred_at desc, m.id desc
),
message_bounds as (
  select
    m.organization_id,
    m.conversation_id,
    max(m.occurred_at) filter (where m.direction = 'inbound') as latest_inbound_at,
    max(m.occurred_at) filter (where m.direction = 'outbound') as latest_outbound_at
  from public.whatsapp_messages m
  where m.deleted_at is null
  group by m.organization_id, m.conversation_id
),
repair as (
  select
    latest_message.*,
    message_bounds.latest_inbound_at,
    message_bounds.latest_outbound_at,
    case
      when nullif(btrim(latest_message.text_body), '') is not null
        then left(latest_message.text_body, 240)
      when latest_message.source = 'phone'
           and latest_message.direction = 'outbound'
           and latest_message.message_type = 'audio'
        then 'Áudio enviado pelo celular'
      when latest_message.source = 'phone'
           and latest_message.direction = 'outbound'
           and latest_message.message_type = 'image'
        then 'Imagem enviada pelo celular'
      when latest_message.source = 'phone'
           and latest_message.direction = 'outbound'
           and latest_message.message_type = 'video'
        then 'Vídeo enviado pelo celular'
      when latest_message.source = 'phone'
           and latest_message.direction = 'outbound'
           and latest_message.message_type = 'document'
        then 'Documento enviado pelo celular'
      when latest_message.source = 'phone'
           and latest_message.direction = 'outbound'
        then 'Mensagem enviada pelo celular'
      else 'Mídia recebida'
    end as latest_preview
  from latest_message
  join message_bounds
    on message_bounds.organization_id = latest_message.organization_id
   and message_bounds.conversation_id = latest_message.conversation_id
)
update public.whatsapp_conversations c
set
  last_message_at = r.occurred_at,
  last_message_preview = r.latest_preview,
  last_inbound_at = case
    when r.latest_inbound_at is not null
      and (c.last_inbound_at is null or r.latest_inbound_at > c.last_inbound_at)
      then r.latest_inbound_at
    else c.last_inbound_at
  end,
  last_outbound_at = case
    when r.latest_outbound_at is not null
      and (c.last_outbound_at is null or r.latest_outbound_at > c.last_outbound_at)
      then r.latest_outbound_at
    else c.last_outbound_at
  end,
  updated_at = now()
from repair r
where c.id = r.conversation_id
  and c.organization_id = r.organization_id
  and (
    c.last_message_at is null
    or c.last_message_at < r.occurred_at
    or (r.latest_inbound_at is not null and (c.last_inbound_at is null or c.last_inbound_at < r.latest_inbound_at))
    or (r.latest_outbound_at is not null and (c.last_outbound_at is null or c.last_outbound_at < r.latest_outbound_at))
  );
