-- Leads que já receberam algum contato (WhatsApp de campanha ou do celular, e-mail de campanha, e-mail marketing).
-- SECURITY INVOKER: as regras de acesso (RLS) das tabelas continuam valendo para quem consulta.
create or replace function public.leads_with_contact(p_organization_id uuid)
returns table(lead_id uuid)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select distinct x.lead_id from (
    select m.lead_id from public.outbound_messages m
      where m.organization_id = p_organization_id and m.status = 'sent' and m.lead_id is not null
    union all
    select w.lead_id from public.whatsapp_messages w
      where w.organization_id = p_organization_id and w.direction = 'outbound' and w.deleted_at is null and w.lead_id is not null
    union all
    select r.lead_id from public.email_campaign_recipients r
      where r.organization_id = p_organization_id and r.lead_id is not null and r.sent_at is not null
    union all
    select l.id from public.email_campaign_recipients r
      join public.email_marketing_contacts c on c.id = r.marketing_contact_id
      join public.leads l on l.organization_id = r.organization_id and lower(l.email) = c.email_normalized and l.deleted_at is null
      where r.organization_id = p_organization_id and r.marketing_contact_id is not null and r.sent_at is not null
  ) x
$$;
revoke all on function public.leads_with_contact(uuid) from public, anon;
grant execute on function public.leads_with_contact(uuid) to authenticated;
