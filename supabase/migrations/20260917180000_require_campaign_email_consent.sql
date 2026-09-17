-- Campaign-level declaration: append-only audit, inaccessible directly to browser roles.
-- Existing campaigns and their recipient records are left unchanged.
CREATE TABLE private.email_campaign_consent_confirmations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  recipients_fingerprint text NOT NULL,
  declaration text NOT NULL
);
ALTER TABLE private.email_campaign_consent_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.email_campaign_consent_confirmations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.email_campaign_consent_confirmations_id_seq FROM PUBLIC, anon, authenticated;
CREATE INDEX email_campaign_consent_confirmations_lookup
  ON private.email_campaign_consent_confirmations (campaign_id, confirmed_at DESC);

-- Include the actual selected recipients and addresses, not a client-provided count.
-- Re-selecting recipients or editing addresses invalidates an earlier declaration.
CREATE FUNCTION private.email_campaign_recipient_fingerprint(p_campaign_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT md5(string_agg(
    r.id::text || '|' || lower(btrim(r.recipient_email)) || '|' ||
    coalesce(r.lead_id::text, '') || '|' ||
    coalesce(r.marketing_contact_id::text, ''),
    E'\n' ORDER BY r.id
  ))
  FROM public.email_campaign_recipients r
  WHERE r.campaign_id = p_campaign_id;
$fn$;
REVOKE ALL ON FUNCTION private.email_campaign_recipient_fingerprint(uuid) FROM PUBLIC, anon, authenticated;

-- Only a signed-in active member (or system admin for a sandbox) can attest.
-- The database records the actual authenticated user and server timestamp.
CREATE FUNCTION public.confirm_email_campaign_consent(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
DECLARE
  v_org uuid;
  v_status text;
  v_is_sandbox boolean;
  v_fingerprint text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para confirmar o consentimento.' USING errcode = '42501';
  END IF;

  SELECT c.organization_id, c.status, o.is_sandbox
    INTO v_org, v_status, v_is_sandbox
  FROM public.email_campaigns c
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE c.id = p_campaign_id
  FOR UPDATE OF c;

  IF v_org IS NULL OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'A confirmação exige uma campanha em rascunho.';
  END IF;
  IF NOT (private.is_active_org_member(v_org) OR
          (private.is_system_admin() AND coalesce(v_is_sandbox, false))) THEN
    RAISE EXCEPTION 'Sem permissão para confirmar esta campanha.' USING errcode = '42501';
  END IF;

  v_fingerprint := private.email_campaign_recipient_fingerprint(p_campaign_id);
  IF v_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Selecione e salve destinatários antes de confirmar o consentimento.';
  END IF;

  INSERT INTO private.email_campaign_consent_confirmations
    (campaign_id, organization_id, confirmed_by, confirmed_at, recipients_fingerprint, declaration)
  VALUES
    (p_campaign_id, v_org, auth.uid(), now(), v_fingerprint,
     'Confirmo que esta campanha não é de prospecção fria e que todos os destinatários selecionados já integram a base da empresa e autorizaram expressamente o recebimento de comunicações comerciais.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.confirm_email_campaign_consent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_email_campaign_consent(uuid) TO authenticated;

-- A direct RPC call to queue_email_campaign cannot bypass the UI checkbox.
-- The existing queuing logic, recipient data, limits and delivery worker stay intact.
CREATE FUNCTION private.guard_email_campaign_consent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
DECLARE
  v_fingerprint text;
BEGIN
  v_fingerprint := private.email_campaign_recipient_fingerprint(NEW.id);
  IF v_fingerprint IS NULL OR NOT EXISTS (
    SELECT 1 FROM private.email_campaign_consent_confirmations a
    WHERE a.campaign_id = NEW.id
      AND a.organization_id = NEW.organization_id
      AND a.recipients_fingerprint = v_fingerprint
  ) THEN
    RAISE EXCEPTION 'Confirme a autorização dos destinatários antes de iniciar o envio.'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.guard_email_campaign_consent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER email_campaign_requires_consent_before_queue
BEFORE UPDATE OF status ON public.email_campaigns
FOR EACH ROW
WHEN (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.guard_email_campaign_consent();
