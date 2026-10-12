-- Reativação: dono de empresa sem pagamento confirmado (assinatura cancelada ou Trial vencido)
-- volta para a própria empresa com acesso restrito, em vez de ter o e-mail liberado.
-- Acesso restrito = plano do usuário "suspended": o CRM mostra a mesma tela do Trial vencido
-- (ver o Kanban, baixar os dados e contratar um plano em "Meu plano").
--
-- Ordem das regras em admin_reactivate_user:
--  1. access_restored    : pagamento confirmado (licença ativa) ou plano liberado sem licença.
--  2. restricted_access  : (NOVO) era dono (proprietário ou criador) de uma empresa ativa, sem pagamento confirmado.
--  3. awaiting_payment   : adicionado pelo administrador da empresa, pagamento pendente.
--  4. email_released     : sem empresa; e-mail liberado para novo cadastro, sem direito ao Trial.

ALTER TABLE public.axiva_user_reactivations DROP CONSTRAINT IF EXISTS axiva_user_reactivations_outcome_check;
ALTER TABLE public.axiva_user_reactivations ADD CONSTRAINT axiva_user_reactivations_outcome_check
  CHECK (outcome IN ('access_restored', 'restricted_access', 'awaiting_payment', 'email_released'));

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(target_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  v_email text;
  v_name text;
  v_org uuid;
  v_org_name text;
  v_role text;
  v_outcome text;
  v_reactivation uuid;
  v_plan text;
BEGIN
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = actor) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT lower(u.email), coalesce(nullif(btrim(p.full_name), ''), u.email)
    INTO v_email, v_name
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE u.id = target_user AND p.deleted_at IS NOT NULL;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado entre os excluídos.';
  END IF;

  -- 1) Pagamento confirmado: licença Billing V2 ativa nesta empresa.
  SELECT c.organization_id INTO v_org
  FROM public.reactivation_candidate_orgs(target_user, v_email) c
  WHERE EXISTS (
    SELECT 1 FROM public.axiva_billing_v2_licenses l
    WHERE l.organization_id = c.organization_id AND l.user_id = target_user AND l.status = 'active'
  )
  ORDER BY c.last_seen DESC
  LIMIT 1;

  -- 1b) Sem licença Billing V2: plano liberado pela Administração ou Trial ainda válido.
  IF v_org IS NULL THEN
    SELECT c.organization_id INTO v_org
    FROM public.reactivation_candidate_orgs(target_user, v_email) c
    JOIN public.user_plan_assignments a
      ON a.organization_id = c.organization_id AND a.user_id = target_user
    WHERE a.status = 'active'
      AND (a.trial_ends_at IS NULL OR a.trial_ends_at > now())
      AND NOT EXISTS (
        SELECT 1 FROM public.axiva_billing_v2_licenses l
        WHERE l.organization_id = c.organization_id AND l.user_id = target_user
      )
    ORDER BY c.last_seen DESC
    LIMIT 1;
  END IF;

  IF v_org IS NOT NULL THEN
    v_outcome := 'access_restored';
  ELSE
    -- 2) Dono da empresa (proprietário ou quem criou) sem pagamento confirmado: acesso restrito.
    SELECT c.organization_id INTO v_org
    FROM public.reactivation_candidate_orgs(target_user, v_email) c
    JOIN public.organizations o ON o.id = c.organization_id
    JOIN public.organization_members m ON m.organization_id = c.organization_id AND m.user_id = target_user
    WHERE m.role = 'owner' OR o.created_by = target_user
    ORDER BY c.last_seen DESC
    LIMIT 1;

    IF v_org IS NOT NULL THEN
      v_outcome := 'restricted_access';
    END IF;
  END IF;

  IF v_outcome IN ('access_restored', 'restricted_access') THEN
    SELECT m.role INTO v_role
    FROM public.organization_members m
    WHERE m.organization_id = v_org AND m.user_id = target_user;

    IF v_role IS NULL THEN
      INSERT INTO public.organization_members(organization_id, user_id, role, is_active, display_name)
      VALUES (v_org, target_user, 'member', true, left(v_name, 80));
    ELSE
      UPDATE public.organization_members
      SET is_active = true, deleted_at = NULL, deleted_by = NULL
      WHERE organization_id = v_org AND user_id = target_user;
    END IF;
  END IF;

  IF v_outcome = 'restricted_access' THEN
    -- Plano suspenso = acesso restrito (Kanban em leitura, download dos dados e contratação).
    -- Trial vencido já é restrito pelo próprio CRM; o registro do Trial não é alterado.
    IF EXISTS (
      SELECT 1 FROM public.user_plan_assignments a
      WHERE a.organization_id = v_org AND a.user_id = target_user
    ) THEN
      UPDATE public.user_plan_assignments
      SET status = 'suspended', updated_at = now()
      WHERE organization_id = v_org AND user_id = target_user
        AND status = 'active' AND trial_ends_at IS NULL;
    ELSE
      SELECT l.plan_id INTO v_plan
      FROM public.axiva_billing_v2_licenses l
      JOIN public.crm_plans p ON p.id = l.plan_id
      WHERE l.organization_id = v_org AND l.user_id = target_user
      ORDER BY l.updated_at DESC NULLS LAST
      LIMIT 1;

      IF v_plan IS NULL THEN
        SELECT p.id INTO v_plan FROM public.crm_plans p WHERE p.id = 'axiva';
      END IF;

      IF v_plan IS NOT NULL THEN
        INSERT INTO public.user_plan_assignments(organization_id, user_id, plan_id, status, assigned_by, assigned_at, updated_at)
        VALUES (v_org, target_user, v_plan, 'suspended', actor, now(), now());
      END IF;
    END IF;
  END IF;

  IF v_outcome IS NULL THEN
    -- 3) Adicionado pelo administrador da empresa e aguardando o pagamento.
    SELECT c.organization_id INTO v_org
    FROM public.reactivation_candidate_orgs(target_user, v_email) c
    WHERE EXISTS (
      SELECT 1 FROM public.axiva_billing_v2_orders o
      WHERE o.organization_id = c.organization_id
        AND o.order_type = 'add_license'
        AND o.environment = 'production'
        AND (o.user_id = target_user OR lower(o.target_email) = v_email)
        AND o.status IN ('pending', 'checkout_created')
    )
    ORDER BY c.last_seen DESC
    LIMIT 1;

    v_outcome := CASE WHEN v_org IS NOT NULL THEN 'awaiting_payment' ELSE 'email_released' END;
  END IF;

  IF v_outcome IN ('access_restored', 'restricted_access', 'awaiting_payment') THEN
    UPDATE public.profiles
    SET account_status = 'active',
        deleted_at = NULL,
        deleted_by = NULL,
        status_changed_at = now(),
        status_changed_by = actor
    WHERE id = target_user;
  ELSE
    -- 4) Sem empresa: a conta antiga continua arquivada e o e-mail perde o direito ao Trial.
    INSERT INTO public.axiva_trial_blocked_emails(email, user_id, reason, created_by)
    VALUES (v_email, target_user, 'reactivated_without_company', actor)
    ON CONFLICT (email) DO NOTHING;
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_org;

  INSERT INTO public.axiva_user_reactivations(user_id, email, outcome, organization_id, created_by)
  VALUES (target_user, v_email, v_outcome, v_org, actor)
  RETURNING id INTO v_reactivation;

  INSERT INTO public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_org, actor, 'user_reactivated', 'user', target_user::text,
          jsonb_build_object('outcome', v_outcome, 'email', v_email));

  RETURN jsonb_build_object(
    'reactivation_id', v_reactivation,
    'outcome', v_outcome,
    'email', v_email,
    'full_name', v_name,
    'organization_id', v_org,
    'organization_name', v_org_name
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_reactivate_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(uuid) TO authenticated;
