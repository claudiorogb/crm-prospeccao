-- Busca de leads passa a considerar também o nome do vendedor (assigned_to, ou captured_by quando não há responsável).
do $$
declare d text; nd text;
begin
  d := pg_get_functiondef('public.get_leads_page(uuid,text,uuid,text,integer,integer)'::regprocedure);
  nd := replace(d,
    E'or l.phone ilike ''%'' || btrim(p_search) || ''%''\n      )',
    E'or l.phone ilike ''%'' || btrim(p_search) || ''%''\n        or exists (\n          select 1 from public.organization_members sm\n          where sm.organization_id = l.organization_id\n            and sm.user_id = coalesce(l.assigned_to, l.captured_by)\n            and sm.deleted_at is null and sm.is_active = true\n            and sm.display_name ilike ''%'' || btrim(p_search) || ''%''\n        )\n      )');
  if nd = d then raise exception 'padrão de busca não encontrado'; end if;
  execute nd;
end $$;
