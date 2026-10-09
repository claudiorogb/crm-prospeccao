-- Arquivamento (exclusão lógica) de organização pela Administração do sistema.
-- Mesmo padrão de archive_user_soft: nada é apagado do banco; a organização some
-- das telas (Organizações, Usuários, Planos) e os vínculos dos membros são arquivados.
-- Não toca em Billing V2 / Asaas: se houver licença ainda ativa, a exclusão é bloqueada.

CREATE OR REPLACE FUNCTION public.archive_organization_soft(target_organization uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = actor) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = target_organization AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Organização não encontrada ou já excluída.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.axiva_billing_v2_licenses l
    WHERE l.organization_id = target_organization
      AND coalesce(l.status, '') NOT IN ('cancelled', 'canceled', 'expired', 'suspended')
  ) THEN
    RAISE EXCEPTION 'Esta organização tem assinatura ativa. Cancele a assinatura antes de excluir a organização.';
  END IF;

  UPDATE public.organizations
  SET is_active = false,
      deleted_at = now(),
      deleted_by = actor,
      updated_at = now()
  WHERE id = target_organization;

  UPDATE public.organization_members
  SET is_active = false,
      deleted_at = COALESCE(deleted_at, now()),
      deleted_by = COALESCE(deleted_by, actor)
  WHERE organization_id = target_organization
    AND deleted_at IS NULL;

  INSERT INTO public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (target_organization, actor, 'organization_archived', 'organization', target_organization::text,
          jsonb_build_object('source', 'admin_organizations_page'));
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_organization_soft(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.archive_organization_soft(uuid) TO authenticated;
