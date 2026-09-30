create index if not exists whatsapp_messages_sent_by_user_idx
  on public.whatsapp_messages (sent_by_user_id)
  where sent_by_user_id is not null;

create index if not exists whatsapp_quick_replies_created_by_idx
  on public.whatsapp_quick_replies (created_by)
  where created_by is not null;