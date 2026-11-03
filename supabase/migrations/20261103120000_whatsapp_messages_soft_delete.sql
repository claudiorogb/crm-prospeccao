alter table public.whatsapp_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

comment on column public.whatsapp_messages.deleted_at is 'Mensagem apagada do CRM (texto e metadados são limpos; a linha fica só para o provedor não recriar a mensagem).';
