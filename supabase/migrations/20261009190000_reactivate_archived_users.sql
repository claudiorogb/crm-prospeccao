-- Reativação de usuários excluídos (arquivados) pela Administração do sistema.
--
-- Regras (decididas em admin_reactivate_user):
--  1. access_restored  : o usuário está ligado a uma empresa ativa e o pagamento dele está confirmado
--                        (licença Billing V2 ativa; ou, sem licença, plano liberado ainda válido).
--                        O vínculo com a empresa é restaurado e a Edge Function envia o e-mail de
--                        redefinição de senha.
--  2. awaiting_payment : o administrador da empresa adicionou o usuário (pedido add_license) e o
--                        pagamento ainda não foi confirmado. O perfil é reativado; quando o Asaas
--                        confirmar o pagamento, o webhook de produção (sem alteração) vincula o
--                        usuário e envia o e-mail para definir a senha.
--  3. email_released   : não está ligado a nenhuma empresa. A conta antiga continua arquivada, o
--                        e-mail é liberado para um novo cadastro (a Edge Function troca o e-mail da
--                        conta antiga) e o e-mail perde o direito ao Trial de 30 dias.

-- E-mails que não podem mais iniciar o Trial de 30 dias.
CREATE TABLE IF NOT EXISTS public.axiva_trial_blocked_emails (
  email text PRIMARY KEY CHECK (email = lower(btrim(email))),
  user_id uuid,
  reason text NOT NULL DEFAULT 'reactivated_without_company',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.axiva_trial_blocked_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.axiva_trial_blocked_emails FROM anon, authenticated;

-- Histórico das reativações.
CREATE TABLE IF NOT EXISTS public.axiva_user_reactivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  outcome text NOT NULL CHECK (outcome IN ('access_restored', 'awaiting_payment', 'email_released')),
  organization_id uuid,
  email_sent boolean,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.axiva_user_reactivations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.axiva_user_reactivations FROM anon, authenticated;

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

  -- Empresas candidatas: as que pediram a licença deste e-mail (Equipe › Adicionar usuário)
  -- e as que já tiveram o usuário como membro. Só valem empresas ativas e não excluídas.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.reactivation_candidates (
    organization_id uuid PRIMARY KEY, last_seen timestamptz
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.reactivation_candidates;

  INSERT INTO pg_temp.reactivation_candidates
  SELECT x.organization_id, max(x.seen)
  FROM (
    SELECT o.organization_id, o.created_at AS seen
    FROM public.axiva_billing_v2_orders o
    WHERE o.order_type = 'add_license'
      AND o.environment = 'production'
      AND (o.user_id = target_user OR lower(o.target_email) = v_email)
      AND o.status IN ('pending', 'checkout_created', 'paid')
    UNION ALL
    SELECT m.organization_id, coalesce(m.deleted_at, m.created_at)
    FROM public.organization_members m
    WHERE m.user_id = target_user
  ) x
  JOIN public.organizations org ON org.id = x.organization_id
  WHERE org.deleted_at IS NULL AND org.is_active = true
  GROUP BY x.organization_id;

  -- 1) Pagamento confirmado: licença ativa nesta empresa.
  SELECT c.organization_id INTO v_org
  FROM pg_temp.reactivation_candidates c
  WHERE EXISTS (
    SELECT 1 FROM public.axiva_billing_v2_licenses l
    WHERE l.organization_id = c.organization_id AND l.user_id = target_user AND l.status = 'active'
  )
  ORDER BY c.last_seen DESC
  LIMIT 1;

  -- 1b) Sem licença Billing V2 (plano liberado pela Administração ou Trial ainda válido).
  IF v_org IS NULL THEN
    SELECT c.organization_id INTO v_org
    FROM pg_temp.reactivation_candidates c
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
  ELSE
    -- 2) Adicionado pelo administrador da empresa, aguardando o pagamento.
    SELECT c.organization_id INTO v_org
    FROM pg_temp.reactivation_candidates c
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

  IF v_outcome IN ('access_restored', 'awaiting_payment') THEN
    UPDATE public.profiles
    SET account_status = 'active',
        deleted_at = NULL,
        deleted_by = NULL,
        status_changed_at = now(),
        status_changed_by = actor
    WHERE id = target_user;
  ELSE
    -- A conta antiga continua arquivada; o e-mail perde o direito ao Trial.
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

REVOKE ALL ON FUNCTION public.admin_reactivate_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(uuid) TO authenticated;

-- Trial dentro do CRM: e-mails liberados para novo cadastro não podem iniciar o Trial.
CREATE OR REPLACE FUNCTION public.start_axiva_trial_from_signup(p_cnpj text, p_organization_name text, p_terms_version text, p_privacy_version text, p_terms_accepted boolean DEFAULT false, p_accepted_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_cnpj text := public.normalize_cnpj(p_cnpj);
  v_org_id uuid;
  v_start timestamptz := now();
  v_end timestamptz := now() + interval '30 days';
  v_accepted_at timestamptz := coalesce(p_accepted_at, v_start);
  v_email text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_cnpj is null or length(v_cnpj) <> 14 then raise exception 'INVALID_CNPJ'; end if;
  if nullif(btrim(p_organization_name),'') is null then raise exception 'INVALID_ORGANIZATION_NAME'; end if;
  if p_terms_accepted is not true
     or nullif(btrim(p_terms_version),'') is null
     or nullif(btrim(p_privacy_version),'') is null then
    raise exception 'TERMS_ACCEPTANCE_REQUIRED';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user_id;
  if nullif(btrim(v_email),'') is null then raise exception 'EMAIL_REQUIRED'; end if;

  if exists (select 1 from public.axiva_trial_blocked_emails b where b.email = lower(btrim(v_email))) then
    raise exception 'Este e-mail não tem mais direito ao período de testes de 30 dias. Escolha um plano para contratar o AXIVA CRM.';
  end if;

  if exists (
    select 1 from public.organization_members om
    where om.user_id = v_user_id and om.is_active = true and om.deleted_at is null
  ) then
    raise exception 'USER_ALREADY_LINKED';
  end if;

  if exists (select 1 from public.organizations o where o.cnpj = v_cnpj) then
    raise exception 'CNPJ_TRIAL_ALREADY_USED';
  end if;

  begin
    insert into public.organizations(name,created_by,cnpj,trial_used_at)
    values(left(btrim(p_organization_name),160),v_user_id,v_cnpj,v_start)
    returning id into v_org_id;
  exception when unique_violation then
    raise exception 'CNPJ_TRIAL_ALREADY_USED';
  end;

  insert into public.organization_members(organization_id,user_id,role,is_active,display_name)
  values(v_org_id,v_user_id,'admin',true,left(btrim(p_organization_name),80));

  insert into public.organization_settings(
    organization_id,default_city,default_state,feature_flags,
    google_places_leads_per_capture,google_places_calls_per_capture
  ) values (
    v_org_id,null,null,
    '{"leads":true,"capture":true,"messages":true,"whatsapp":true,"campaigns":true,"ai_assistant":true}'::jsonb,
    40,2
  );

  insert into public.ai_organization_settings(
    organization_id,enabled,daily_message_limit,daily_request_limit
  ) values(v_org_id,true,10,10);

  insert into public.user_plan_assignments(
    organization_id,user_id,plan_id,status,trial_started_at,trial_ends_at,assigned_by
  ) values(v_org_id,v_user_id,'free_30_days','active',v_start,v_end,v_user_id);

  insert into public.axiva_trial_terms_acceptances(
    user_id,organization_id,cnpj,email,terms_version,privacy_version,
    accepted_at,trial_started_at,trial_ends_at
  ) values(
    v_user_id,v_org_id,v_cnpj,v_email,
    left(btrim(p_terms_version),100),left(btrim(p_privacy_version),100),
    v_accepted_at,v_start,v_end
  );

  return jsonb_build_object(
    'organization_id',v_org_id,
    'plan_id','free_30_days',
    'trial_started_at',v_start,
    'trial_ends_at',v_end
  );
end;
$function$;
