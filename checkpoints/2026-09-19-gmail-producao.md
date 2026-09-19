# Checkpoint AXIVA CRM — 2026-09-19 — Gmail em produção

## Código preservado
- Repositório: `claudiorogb/crm-prospeccao`.
- Commit de origem imutável: `ced1270735284167dca8217a1bfbf643e47e1add`.
- Branch de preservação: `checkpoint/2026-09-19-gmail-producao-backup` (criada a partir desse commit; este documento é o único acréscimo previsto).
- Não mesclar a branch automaticamente nem aplicar restauração em produção.

## Estado funcional relatado e verificações anteriores
- Projeto Google OAuth `axiva-crm-producao` / número `1069976020793`: verificação de `gmail.send` aprovada por e-mail do Google, tela Público mostrada pelo proprietário como Externo / Em produção.
- Proprietário informou que uma empresa cadastrada conectou sua própria conta Gmail e enviou/recebeu uma mensagem real.
- Proteções no banco Supabase aplicadas em 2026-09-19 às operações de campanha e lista: administrador/proprietário ativo da própria organização; uma conexão por organização (chave primária em `email_connections.organization_id`). Não alterar/remover sem testes.
- Newsletter, descadastro e confirmação automática tiveram teste manual positivo informado pelo proprietário.

## Backup e recuperação — NÃO CONFUNDIR COM RESTAURAÇÃO VALIDADA
- Projeto Supabase `lhnzpxjjfalxmlkjysor` (CRM Prospecção).
- Rotina GitHub `claudiorogb/crm-backup`, workflow `Backup diário CRM`; pasta Google Drive `Projeto CRM/Backup` (ID `1aySRP6cIjRUGKmUniNQbo4maWCbWdn1o`).
- Backup agendado de 2026-09-19 06:17 UTC encontrado no Drive: `CRM_Prospeccao_2026-09-19_06-17-20_UTC.tar.gz`, mas é anterior a este checkpoint e não substitui um backup novo.
- Arquivo produzido pelo script atual: schema `public`, dados JSON de tabelas `public` com campos sensíveis sanitizados, metadados `auth.users` / `auth.identities` sanitizados, manifesto e SHA-256 no log. **Não é cópia integral/restaurável automaticamente**: não contém senhas/tokens, configurações externas e Storage completo, nem assegura todos os esquemas/objetos do Supabase.
- PENDENTE: disparar manualmente novo workflow, confirmar log de sucesso e arquivo correspondente no Drive, validar integridade do arquivo, preservar demais componentes externos e testar restauração SOMENTE em ambiente isolado sem custo adicional aprovado.

## Regra operacional
Nenhuma exclusão, redefinição de credenciais, alteração de dados de produção, migração, publicação, ou teste de restauração contra produção. Nunca gravar segredos no repositório, documento de checkpoint ou chat.
