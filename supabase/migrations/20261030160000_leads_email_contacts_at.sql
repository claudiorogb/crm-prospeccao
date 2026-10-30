-- Leads sem telefone (só com e-mail) movidos da tela "Enviar mensagens" (WhatsApp) para "Contatos do CRM" (e-mail).
-- Coluna opcional e sem efeito em nenhuma regra existente: só tira o lead da lista de envio por WhatsApp.
alter table public.leads add column if not exists email_contacts_at timestamptz;
comment on column public.leads.email_contacts_at is 'Quando o lead saiu da lista de envio por WhatsApp para os Contatos do CRM (e-mail). Null = continua na lista de envio.';
