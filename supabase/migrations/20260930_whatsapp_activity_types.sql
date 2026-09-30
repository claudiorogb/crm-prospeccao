-- AXIVA CRM - tipos de atividade usados pela Central WhatsApp
alter table public.activities
  drop constraint if exists activities_activity_type_check;

alter table public.activities
  add constraint activities_activity_type_check
  check (activity_type = any (array[
    'queued'::text,
    'message_prepared'::text,
    'message_sent'::text,
    'reply_received'::text,
    'auto_reply_received'::text,
    'call'::text,
    'note'::text,
    'status_change'::text,
    'follow_up'::text,
    'whatsapp'::text,
    'email'::text,
    'meeting'::text
  ]));