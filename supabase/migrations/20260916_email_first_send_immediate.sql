-- O clique em "Iniciar envio" dispara o processador sem aguardar o cron de 1 minuto.
-- Apenas o primeiro destinatário de cada campanha ainda não iniciada pode ignorar
-- o intervalo deixado pela campanha anterior. Os próximos respeitam o limite.
-- A reserva do intervalo ocorre no claim para impedir envios simultâneos.
CREATE OR REPLACE FUNCTION public.email_claim_next_recipient()
RETURNS TABLE(recipient_id uuid, campaign_id uuid, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service_role only' USING errcode='42501';
  END IF;

  UPDATE public.organization_email_limits
     SET sent_today=0, usage_date=v_today, updated_at=now()
   WHERE usage_date<>v_today;

  RETURN QUERY
  WITH candidate AS (
    SELECT r.id AS recipient_id,
           r.campaign_id AS claimed_campaign_id,
           r.organization_id AS claimed_organization_id
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c
        ON c.id=r.campaign_id AND c.organization_id=r.organization_id
      JOIN public.organization_email_limits l
        ON l.organization_id=r.organization_id
      JOIN public.email_connections ec
        ON ec.organization_id=r.organization_id AND ec.status='connected'
     WHERE r.status='queued'
       AND c.status IN ('queued','sending')
       AND COALESCE(c.scheduled_at,now()) <= now()
       AND NOT l.sending_paused
       AND l.daily_send_limit > l.sent_today + (
         SELECT count(*) FROM public.email_campaign_recipients inflight
          WHERE inflight.organization_id=l.organization_id
            AND inflight.status='sending'
       )
       AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
       AND (
         l.last_sent_at IS NULL
         OR l.last_sent_at <= now() - make_interval(secs=>l.send_interval_seconds)
         OR (
           c.started_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients prior
              WHERE prior.campaign_id=c.id AND prior.attempt_count>0
           )
         )
       )
     ORDER BY
       CASE WHEN c.started_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.email_campaign_recipients prior
          WHERE prior.campaign_id=c.id AND prior.attempt_count>0
       ) THEN 0 ELSE 1 END,
       CASE WHEN c.started_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.email_campaign_recipients prior
          WHERE prior.campaign_id=c.id AND prior.attempt_count>0
       ) THEN c.scheduled_at END DESC NULLS LAST,
       r.created_at
     FOR UPDATE OF r, l SKIP LOCKED
     LIMIT 1
  ), upd AS (
    UPDATE public.email_campaign_recipients r
       SET status='sending',
           attempt_count=r.attempt_count+1,
           last_attempt_at=now(),
           updated_at=now()
      FROM candidate c
     WHERE r.id=c.recipient_id
     RETURNING r.id AS recipient_id,
               r.campaign_id AS claimed_campaign_id,
               r.organization_id AS claimed_organization_id
  ), reserve_interval AS (
    UPDATE public.organization_email_limits l
       SET last_sent_at=now(), updated_at=now()
      FROM upd u
     WHERE l.organization_id=u.claimed_organization_id
     RETURNING l.organization_id
  )
  SELECT u.recipient_id, u.claimed_campaign_id, u.claimed_organization_id
    FROM upd u
    JOIN reserve_interval lim ON lim.organization_id=u.claimed_organization_id;
END;
$function$;

-- Mantém autorização, criação da fila e controle de destinatários originais.
-- pg_net agenda a requisição depois do COMMIT: o processador vê a fila já salva.
CREATE OR REPLACE FUNCTION public.queue_email_campaign(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_org uuid;
  v_is_sandbox boolean;
  v_count integer;
  v_processor_secret text;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.email_campaigns
   WHERE id=p_campaign_id AND status IN ('draft','paused','failed');
  IF v_org IS NULL THEN RAISE EXCEPTION 'Campanha não pode ser colocada na fila.'; END IF;

  SELECT is_sandbox INTO v_is_sandbox FROM public.organizations WHERE id=v_org;
  IF NOT (private.is_active_org_member(v_org) OR
          (private.is_system_admin() AND COALESCE(v_is_sandbox,false))) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.email_connections
                  WHERE organization_id=v_org AND status='connected') THEN
    RAISE EXCEPTION 'Conta de e-mail não conectada.';
  END IF;
  SELECT count(*) INTO v_count FROM public.email_campaign_recipients
   WHERE campaign_id=p_campaign_id AND status IN ('draft','failed');
  IF v_count=0 THEN RAISE EXCEPTION 'Selecione pelo menos um destinatário antes de iniciar o envio.'; END IF;

  UPDATE public.email_campaign_recipients
     SET status='queued', queued_at=COALESCE(queued_at,now()),
         updated_at=now(), error_message=NULL
   WHERE campaign_id=p_campaign_id AND status IN ('draft','failed');
  UPDATE public.email_campaigns
     SET status='queued', scheduled_at=COALESCE(scheduled_at,now()),
         updated_at=now(), cancelled_at=NULL
   WHERE id=p_campaign_id;

  -- O cron existente permanece como recuperação se a chamada imediata falhar.
  BEGIN
    v_processor_secret := public.email_get_processor_secret();
    IF v_processor_secret IS NOT NULL AND v_processor_secret<>'' THEN
      PERFORM net.http_post(
        url := 'https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/email-queue-processor',
        body := jsonb_build_object('campaign_id',p_campaign_id),
        headers := jsonb_build_object('Content-Type','application/json',
                                      'X-Processor-Secret',v_processor_secret),
        timeout_milliseconds := 1500
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao acionar envio imediato; o cron processará a fila.';
  END;
END;
$function$;
