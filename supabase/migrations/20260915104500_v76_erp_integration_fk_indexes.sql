-- V76: indices de suporte aos vinculos de auditoria das integracoes.
-- Evitam varreduras completas ao remover ou arquivar contas de usuarios.

create index integration_connections_created_by_idx
  on public.integration_connections (created_by)
  where created_by is not null;

create index integration_connections_updated_by_idx
  on public.integration_connections (updated_by)
  where updated_by is not null;

create index integration_connections_deleted_by_idx
  on public.integration_connections (deleted_by)
  where deleted_by is not null;
