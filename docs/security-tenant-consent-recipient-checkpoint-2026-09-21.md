# AXIVA CRM — checkpoint e correções específicas, 21/09/2026

## Referências imutáveis

- Antes desta rodada: branch `checkpoint-integridade-pre-correcoes-2026-09-21`, commit `ad2dcf062ca2819346ce8f430d3cb6ef30865955` (código e interface; NÃO inclui o banco de dados nem segredos).
- Checkpoint anterior, preservado em `checkpoint-seguranca-2026-09-21`: commit `08bd452ad90407958b0abe7d06d451754613b13e`.
- Supabase CRM `lhnzpxjjfalxmlkjysor`: definições originais de cinco funções guardadas na tabela restrita `private.security_function_snapshots_20260921`, com assinatura, SQL original e MD5. A tabela NÃO é um backup dos dados dos clientes.

## Alterações de produção

1. Migração `checkpoint_security_functions_before_tenant_consent_recipient_fix`: captura as cinco funções antes de alterações.
2. `block_core_tenant_organization_id_reassignment`: bloqueia alteração apenas do `organization_id` em seis tabelas centrais; `preserve_email_recipient_draft_history_without_hard_delete` estende o bloqueio a quatro tabelas de campanhas e anexos.
3. `prevent_consent_reconfirmation_on_import_of_unsubscribed_contacts`: importação não renova consentimento de contatos descadastrados ou inválidos e não marca novo contato como consentido quando houver opt-out no CRM.
4. `preserve_email_recipient_draft_history_without_hard_delete`: inclui `removed_from_draft_at` nos destinatários, registra seleção/retirada/reinclusão em `private.email_recipient_selection_history` (RLS ligado, sem permissões para anon/autenticados), preserva linhas retiradas como `cancelled`, reusa o identificador quando reincluídas, redefine a confirmação comercial ao editar e impede que destinatários retirados sejam copiados em reenvio.
5. Frontend: `src/email-marketing.jsx` filtra `status='draft'` ao reabrir uma campanha em rascunho. A execução de GitHub Actions `35640858895` passou pelos testes de regressão e pelo build. A publicação efetiva em `crm.axiva.com.br` não pôde ser verificada através das ferramentas disponíveis.

## Testes não destrutivos executados

- Simulação de seleção de dois destinatários, retirada e reinclusão de um deles dentro de subtransação intencionalmente revertida: dois atuais, um removido enquanto retirado, mesmo ID após reinclusão e quatro eventos de histórico; todas as alterações de teste revertidas.
- Contagens antes e depois do teste: 22 campanhas, 24 destinatários, zero eventos de histórico de teste persistidos.
- Importação de contato já descadastrado ignorada; status e consentimento não mudaram.
- Tentativas de transferência em dez tabelas existentes rejeitadas por gatilhos. Nenhum registro transferido.
- Tabelas privadas novas: RLS ativo; `anon` e `authenticated` sem SELECT e INSERT.

## Reversão segura

O código anterior está no branch do checkpoint. As definições de funções antes da alteração podem ser consultadas com `select function_signature, definition, definition_md5 from private.security_function_snapshots_20260921;` e revisadas por profissional habilitado antes de aplicar cada `CREATE OR REPLACE FUNCTION` original. **Não** reverta cegamente a função antiga de destinatários: ela contém `DELETE` físico e apagaria registros históricos criados após esta correção. Os campos e a tabela de histórico são aditivos; NÃO apagar nem truncar para fazer rollback. Os bloqueios por gatilho podem ser removidos separadamente apenas se a regra de isolamento for substituída por proteção equivalente. Um rollback de código/funções não restaura automaticamente dados, identidades, Storage ou segredos externos.

## Limitação

Testes de banco e CI concluídos; falta comprovar no domínio de produção o deploy exato do commit atualizado e realizar teste completo com sessões reais de organizações diferentes. Não classificar como auditoria integral aprovada.
