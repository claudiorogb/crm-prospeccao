-- Keep the tenant authorization, status rules, limits, and all existing data intact.
-- get_leads_page is a funnel-only RPC: imported portfolio customers are not funnel wins.
DO $v98_funnel$
DECLARE
  v_definition text := pg_get_functiondef('public.get_leads_page(uuid,text,uuid,text,integer,integer)'::regprocedure);
  v_old text := $old$      and l.deleted_at is null
      and (p_target_segment_id is null or l.target_segment_id = p_target_segment_id)$old$;
  v_new text := $new$      and l.deleted_at is null
      and not (l.source='import' and l.status='won')
      and (p_target_segment_id is null or l.target_segment_id = p_target_segment_id)$new$;
BEGIN
  IF v_definition IS NULL OR strpos(v_definition,v_old)=0
     OR strpos(substr(v_definition,strpos(v_definition,v_old)+length(v_old)),v_old)>0 THEN
    RAISE EXCEPTION 'V98 funnel: expected RPC anchor not found exactly once; no changes applied.';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$v98_funnel$;
