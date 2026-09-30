insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 8388608)
on conflict (id) do update
set public = false,
    file_size_limit = 8388608;