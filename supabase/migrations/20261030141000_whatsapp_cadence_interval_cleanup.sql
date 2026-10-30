-- Limpeza de expressão redundante no cálculo do intervalo (sem mudança de comportamento).
do $$
declare d text;
begin
  d := pg_get_functiondef('private.run_whatsapp_cadence(boolean)'::regprocedure);
  d := replace(d, 'greatest(1, coalesce(s.whatsapp_sending_paused, false)::int * 0 + coalesce(s.whatsapp_send_interval_seconds, 120))', 'greatest(1, coalesce(s.whatsapp_send_interval_seconds, 120))');
  execute d;
end $$;
