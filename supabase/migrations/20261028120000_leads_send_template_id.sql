-- Mensagem escolhida no cadastro manual de "Enviar mensagens".
-- Coluna opcional: leads atuais e captados ficam vazios e continuam usando a mensagem da campanha.

alter table public.leads
  add column if not exists send_template_id uuid null
  references public.message_templates(id) on delete no action;

comment on column public.leads.send_template_id is
  'Mensagem escolhida no cadastro manual em Enviar mensagens. Vazio = mensagem da campanha.';

create index if not exists idx_leads_send_template_id
  on public.leads (send_template_id) where send_template_id is not null;

-- Segurança por empresa: a mensagem escolhida precisa ser da mesma empresa do lead.
create or replace function private.enforce_lead_send_template_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.send_template_id is not null then
    perform private.assert_same_org('public.message_templates'::regclass, new.send_template_id, new.organization_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_lead_send_template_org on public.leads;

create trigger trg_lead_send_template_org
  before insert or update of send_template_id, organization_id on public.leads
  for each row execute function private.enforce_lead_send_template_org();
