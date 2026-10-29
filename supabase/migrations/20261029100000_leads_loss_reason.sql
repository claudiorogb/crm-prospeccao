-- Motivo estruturado de perda / não interesse (aditivo; não altera colunas nem políticas existentes).
alter table public.leads add column if not exists loss_reason text;
comment on column public.leads.loss_reason is 'Código do motivo de perda/não interesse (ex.: price, competitor). Texto livre continua em commercial_notes.';
