-- V98: a customer imported directly into the portfolio has status='won', source='import'.
-- Preserve these existing rows and their sales, activities, customer page and import RPC.
-- Exclude only direct imports from funnel/conversion statistics. Do not change RLS,
-- authorization, function signatures, ownership, data, or genuine funnel wins.
-- Each replacement requires exactly one matching anchor; any drift aborts the
-- entire transactional migration instead of replacing an unexpected function.
DO $axiva_v98$
DECLARE
  v_patch jsonb;
  v_signature text;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  FOR v_patch IN
    SELECT value FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object(
        'signature', 'public.get_dashboard_stats(uuid)',
        'old', $old$  from public.leads
  where organization_id = p_organization_id
    and deleted_at is null
),$old$,
        'new', $new$  from public.leads
  where organization_id = p_organization_id
    and deleted_at is null
    and not (source = 'import' and status = 'won')
),$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_dashboard_stats(uuid)',
        'old', $old$    and l.status = 'won'
    and l.deleted_at is null$old$,
        'new', $new$    and l.status = 'won'
    and l.source <> 'import'
    and l.deleted_at is null$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_seller_performance(uuid)',
        'old', $old$    where l.organization_id=p_organization_id and l.deleted_at is null
    group by coalesce(l.assigned_to,l.captured_by)$old$,
        'new', $new$    where l.organization_id=p_organization_id and l.deleted_at is null
      and not (l.source='import' and l.status='won')
    group by coalesce(l.assigned_to,l.captured_by)$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_origin_conversion(uuid)',
        'old', $old$      l.status,
      l.last_contact_date,$old$,
        'new', $new$      l.status,
      l.source,
      l.last_contact_date,$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_origin_conversion(uuid)',
        'old', $old$    count(*)::bigint as leads_total,$old$,
        'new', $new$    count(*) filter (where not (nl.source='import' and nl.status='won'))::bigint as leads_total,$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_origin_conversion(uuid)',
        'old', $old$    count(*) filter (
      where nl.last_contact_date is not null
         or nl.last_contacted_at is not null
         or nl.status in ('contacted','replied','interested','proposal','negotiation','not_interested','won','lost')
    )::bigint as contacted,$old$,
        'new', $new$    count(*) filter (
      where not (nl.source='import' and nl.status='won')
        and (nl.last_contact_date is not null
          or nl.last_contacted_at is not null
          or nl.status in ('contacted','replied','interested','proposal','negotiation','not_interested','won','lost'))
    )::bigint as contacted,$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_origin_conversion(uuid)',
        'old', $old$    count(*) filter (where nl.status='won')::bigint as won_count,$old$,
        'new', $new$    count(*) filter (where nl.status='won' and nl.source<>'import')::bigint as won_count,$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_origin_conversion(uuid)',
        'old', $old$    case when count(*)=0 then 0::numeric
         else round(100.0*count(*) filter (where nl.status='won')/count(*),2)
    end as conversion_rate$old$,
        'new', $new$    case when count(*) filter (where not (nl.source='import' and nl.status='won'))=0 then 0::numeric
         else round(100.0*(count(*) filter (where nl.status='won' and nl.source<>'import'))
           /(count(*) filter (where not (nl.source='import' and nl.status='won'))),2)
    end as conversion_rate$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_platform_sales_overview()',
        'old', $old$         count(DISTINCT l.id) FILTER (WHERE l.deleted_at IS NULL AND l.status='won')::bigint,$old$,
        'new', $new$         count(DISTINCT l.id) FILTER (WHERE l.deleted_at IS NULL AND l.status='won' AND l.source<>'import')::bigint,$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_platform_sales_overview()',
        'old', $old$         coalesce(sum(s.amount) FILTER (WHERE l.deleted_at IS NULL AND l.status='won' AND s.deleted_at IS NULL),0)::numeric$old$,
        'new', $new$         coalesce(sum(s.amount) FILTER (WHERE l.deleted_at IS NULL AND l.status='won' AND l.source<>'import' AND s.deleted_at IS NULL),0)::numeric$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_team_performance(uuid)',
        'old', $old$      count(distinct l.id) filter (where l.status='won')::bigint won_count,$old$,
        'new', $new$      count(distinct l.id) filter (where l.status='won' and l.source<>'import')::bigint won_count,$new$
      ),
      jsonb_build_object(
        'signature', 'public.get_team_performance(uuid)',
        'old', $old$      coalesce(sum(s.amount) filter (where l.status='won'),0)::numeric won_value$old$,
        'new', $new$      coalesce(sum(s.amount) filter (where l.status='won' and l.source<>'import'),0)::numeric won_value$new$
      )
    )) AS patches(value)
  LOOP
    v_signature := v_patch->>'signature';
    v_old := v_patch->>'old';
    v_new := v_patch->>'new';
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    IF v_definition IS NULL OR strpos(v_definition, v_old)=0
       OR strpos(substr(v_definition, strpos(v_definition, v_old) + length(v_old)), v_old)>0 THEN
      RAISE EXCEPTION 'V98 refused to update %: the expected source anchor is missing or repeated.', v_signature;
    END IF;
    EXECUTE replace(v_definition, v_old, v_new);
  END LOOP;
END;
$axiva_v98$;
