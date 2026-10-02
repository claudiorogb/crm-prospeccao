do $$
begin
  if not exists (select 1 from vault.secrets where name = 'axiva_file_security_cleanup') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'axiva_file_security_cleanup', 'Token interno para limpeza da quarentena de arquivos');
  end if;
end;
$$;

create or replace function public.verify_file_security_cleanup_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'axiva_file_security_cleanup'
      and decrypted_secret = p_token
  );
$$;

revoke all on function public.verify_file_security_cleanup_token(text) from public, anon, authenticated;
grant execute on function public.verify_file_security_cleanup_token(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'axiva-file-security-cleanup') then
    perform cron.unschedule('axiva-file-security-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'axiva-file-security-cleanup',
  '15 5 * * *',
  $cron$
    select net.http_post(
      url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/file-security-cleanup',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-token', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'axiva_file_security_cleanup' limit 1
        )
      ),
      timeout_milliseconds := 30000
    );
  $cron$
);
