-- Retorno atrasado: um contato feito NO PRÓPRIO dia do retorno, sem marcar novo retorno,
-- não cumpre mais o retorno (só contato em data posterior à prevista tira o atraso).
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_leads_page';
  if d is null or position('last_contact_date < next_contact_date' in d)=0 then
    raise exception 'get_leads_page não contém o trecho esperado';
  end if;
  d := replace(d, 'last_contact_date < next_contact_date', 'last_contact_date <= next_contact_date');
  execute d;
end $$;
