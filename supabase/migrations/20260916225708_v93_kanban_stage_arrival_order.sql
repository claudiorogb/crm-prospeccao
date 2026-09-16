-- V93: Ordena os cartões pela entrada na fase, não pelo cadastro.
-- O gatilho existente trg_touch_lead_status_changed_at atualiza esse timestamp
-- apenas quando o status realmente muda. Não altera dados de leads nem RLS.
do $v93$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.get_leads_page(uuid,text,uuid,text,integer,integer)'::regprocedure);

  if definition is null
    or position('order by b.created_at desc, b.id desc' in definition) = 0
    or position('order by l.created_at desc, l.id desc' in definition) = 0
    or position('      l.created_at,' || chr(10) || '      l.proposal_value,' in definition) = 0
    or position('''created_at'', l.created_at,' in definition) = 0
    or position('status_changed_at' in definition) > 0
  then
    raise exception 'V93: get_leads_page não corresponde à versão esperada; nenhuma alteração aplicada';
  end if;

  definition := replace(
    definition,
    '      l.created_at,' || chr(10) || '      l.proposal_value,',
    '      l.created_at,' || chr(10) || '      l.status_changed_at,' || chr(10) || '      l.proposal_value,'
  );
  definition := replace(
    definition,
    'order by b.created_at desc, b.id desc',
    'order by b.status_changed_at asc nulls last, b.created_at asc, b.id asc'
  );
  definition := replace(
    definition,
    'order by l.created_at desc, l.id desc',
    'order by l.status_changed_at asc nulls last, l.created_at asc, l.id asc'
  );
  definition := replace(
    definition,
    '''created_at'', l.created_at,',
    '''created_at'', l.created_at,' || chr(10) || '      ''status_changed_at'', l.status_changed_at,'
  );
  execute definition;
end
$v93$;
