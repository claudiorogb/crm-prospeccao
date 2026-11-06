-- Ocultar leads de listas específicas (somente visual; o lead continua na Lista de clientes e no Kanban).
-- Campos novos, vazios para todos os leads: nenhum comportamento atual muda.
alter table public.leads add column if not exists sending_hidden_at timestamptz;
alter table public.leads add column if not exists email_contacts_hidden_at timestamptz;

comment on column public.leads.sending_hidden_at is 'Preenchido quando o lead foi ocultado da lista de envio por WhatsApp (Enviar mensagens).';
comment on column public.leads.email_contacts_hidden_at is 'Preenchido quando o lead foi ocultado de Contatos do CRM (Prospecção por e-mail).';
