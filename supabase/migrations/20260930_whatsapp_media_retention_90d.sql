-- AXIVA CRM - retenção automática de mídias WhatsApp por 90 dias.
-- Exclusão física é feita via Storage API por Edge Function; nunca por DELETE direto em storage.objects.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'axiva_whatsapp_media_cleanup') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'axiva_whatsapp_media_cleanup',
      'Token interno para limpeza automática das mídias WhatsApp'
    );
  end if;
end;
$$;

create or replace function public.verify_whatsapp_media_cleanup_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from vault.decrypted_secrets
     where name = 'axiva_whatsapp_media_cleanup'
       and decrypted_secret = p_token
  );
$$;

revoke all on function public.verify_whatsapp_media_cleanup_token(text) from public, anon, authenticated;
grant execute on function public.verify_whatsapp_media_cleanup_token(text) to service_role;

create or replace function public.list_expired_whatsapp_media(p_limit integer default 500)
returns table(name text)
language sql
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'whatsapp-media'
     and o.created_at < now() - interval '90 days'
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

revoke all on function public.list_expired_whatsapp_media(integer) from public, anon, authenticated;
grant execute on function public.list_expired_whatsapp_media(integer) to service_role;

create or replace function public.mark_whatsapp_media_expired(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return 0;
  end if;

  update public.whatsapp_messages
     set media_metadata =
       (coalesce(media_metadata, '{}'::jsonb) - 'storage_path')
       || jsonb_build_object('expired_at', now())
   where media_metadata ->> 'storage_path' = any (p_paths);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_whatsapp_media_expired(text[]) from public, anon, authenticated;
grant execute on function public.mark_whatsapp_media_expired(text[]) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'axiva-whatsapp-media-cleanup') then
    perform cron.unschedule('axiva-whatsapp-media-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'axiva-whatsapp-media-cleanup',
  '30 6 * * *',
  $cron$
    select net.http_post(
      url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/whatsapp-media-cleanup',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-token', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'axiva_whatsapp_media_cleanup'
           limit 1
        )
      ),
      timeout_milliseconds := 30000
    );
  $cron$
);