-- V101: additive, read-only export. No existing tables, data, policies or functions are altered.
-- The export is never a service-role operation: each request must be authenticated
-- as an active owner/admin of the exact active organization being exported.
CREATE OR REPLACE FUNCTION public.export_crm_data_page(
  p_organization_id uuid,
  p_dataset text,
  p_after_id text DEFAULT NULL,
  p_page_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $export$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_organization_id IS NULL OR auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS m
    JOIN public.organizations AS o ON o.id = m.organization_id
    JOIN public.profiles AS p ON p.id = m.user_id
    WHERE m.organization_id = p_organization_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
      AND m.is_active IS TRUE
      AND m.deleted_at IS NULL
      AND o.is_active IS TRUE
      AND o.deleted_at IS NULL
      AND p.account_status = 'active'
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Exportação não autorizada para esta empresa' USING ERRCODE = '42501';
  END IF;

  IF p_dataset IS NULL OR p_dataset NOT IN ('leads', 'clients', 'activities', 'journey', 'tasks', 'sales') THEN
    RAISE EXCEPTION 'Conjunto de dados inválido' USING ERRCODE = '22023';
  END IF;
  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 500 THEN
    RAISE EXCEPTION 'Tamanho de página inválido' USING ERRCODE = '22023';
  END IF;

  IF p_dataset IN ('leads', 'clients') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT l.id, l.organization_id, l.business_name, l.legal_name, l.cnpj,
        l.segment, l.contact_name, l.contact_role, l.phone, l.whatsapp_phone,
        l.email, l.website, l.address, l.city, l.state, l.source,
        l.campaign_id, l.target_segment_id, l.status, l.last_contact_date,
        l.next_contact_date, l.proposal_value, l.proposal_sent_at,
        l.renegotiated_value, l.contract_value, l.contract_signed_at,
        l.commercial_notes, l.assigned_to, l.created_at, l.status_changed_at,
        l.deleted_at
      FROM public.leads AS l
      WHERE l.organization_id = p_organization_id
        AND ((p_dataset = 'clients' AND l.status = 'won')
          OR (p_dataset = 'leads' AND l.status <> 'won'))
        AND (p_after_id IS NULL OR l.id > p_after_id::uuid)
      ORDER BY l.id
      LIMIT p_page_size
    ) AS r;

  ELSIF p_dataset = 'tasks' THEN
    -- There is no standalone tasks table. Export actual stored next-contact
    -- dates; do not invent task histories or claim that these are completed tasks.
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT l.id, l.organization_id, l.business_name, l.contact_name,
        l.status, l.next_contact_date, l.deleted_at
      FROM public.leads AS l
      WHERE l.organization_id = p_organization_id
        AND l.next_contact_date IS NOT NULL
        AND (p_after_id IS NULL OR l.id > p_after_id::uuid)
      ORDER BY l.id
      LIMIT p_page_size
    ) AS r;

  ELSIF p_dataset = 'activities' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT a.id, a.organization_id, a.lead_id, a.activity_type,
        a.channel, a.notes, a.occurred_at, a.created_by, a.created_at
      FROM public.activities AS a
      JOIN public.leads AS l ON l.id = a.lead_id AND l.organization_id = a.organization_id
      WHERE a.organization_id = p_organization_id
        AND (p_after_id IS NULL OR a.id > p_after_id::uuid)
      ORDER BY a.id
      LIMIT p_page_size
    ) AS r;

  ELSIF p_dataset = 'journey' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r) - '_sort_id' ORDER BY r._sort_id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT j.id::text AS id, j.id AS _sort_id, j.organization_id, j.lead_id,
        j.stage, j.contact_name, j.note, j.proposal_value,
        j.renegotiated_value, j.contract_value, j.created_by, j.created_at
      FROM public.lead_journey_entries AS j
      JOIN public.leads AS l ON l.id = j.lead_id AND l.organization_id = j.organization_id
      WHERE j.organization_id = p_organization_id
        AND (p_after_id IS NULL OR j.id > p_after_id::bigint)
      ORDER BY j.id
      LIMIT p_page_size
    ) AS r;

  ELSE -- sales
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT s.id, s.organization_id, s.lead_id, s.sale_date,
        s.amount, s.product_service, s.notes, s.origin,
        s.created_by, s.created_at, s.deleted_at
      FROM public.sales AS s
      JOIN public.leads AS l ON l.id = s.lead_id AND l.organization_id = s.organization_id
      WHERE s.organization_id = p_organization_id
        AND (p_after_id IS NULL OR s.id > p_after_id::uuid)
      ORDER BY s.id
      LIMIT p_page_size
    ) AS r;
  END IF;

  RETURN v_rows;
END;
$export$;

REVOKE ALL ON FUNCTION public.export_crm_data_page(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_crm_data_page(uuid, text, text, integer) TO authenticated;
COMMENT ON FUNCTION public.export_crm_data_page(uuid, text, text, integer)
IS 'V101: read-only five-tab CRM export, 500-row pages, active owner/admin only, exact organization per page';
