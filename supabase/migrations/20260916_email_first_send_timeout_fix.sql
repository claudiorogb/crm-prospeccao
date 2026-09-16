-- O processamento do Gmail pode levar mais que 1,5 segundo. Sem tempo suficiente,
-- a chamada HTTP pode ser interrompida durante o envio e deixar um destinatário
-- marcado como "sending". Mantém o cron como recuperação de falhas ao disparar.
DO $migration$
DECLARE
  definition text;
BEGIN
  definition := pg_get_functiondef('public.queue_email_campaign(uuid)'::regprocedure);
  IF position('timeout_milliseconds := 1500' IN definition)>0 THEN
    EXECUTE replace(definition, 'timeout_milliseconds := 1500', 'timeout_milliseconds := 60000');
  ELSIF position('timeout_milliseconds := 60000' IN definition)=0 THEN
    RAISE EXCEPTION 'Formato inesperado da função queue_email_campaign; não foi possível ajustar o timeout.';
  END IF;
END;
$migration$;
