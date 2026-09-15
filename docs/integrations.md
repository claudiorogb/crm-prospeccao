# Integrações do AXIVA CRM

## Objetivo

O CRM foi preparado para conversar com ERP, e-commerce, financeiro, emissão fiscal e sistemas próprios sem acoplar o núcleo comercial a um fornecedor específico.

O CRM continua sendo responsável por leads, funil, clientes, contatos e vendas. O sistema externo continua responsável por pedido, faturamento, nota, estoque e recebimento. Cada dado deve ter um único sistema de origem para evitar duplicidade e divergência.

## Componentes

- `integration_connections`: metadados não sigilosos de cada conexão por organização.
- `integration_external_links`: relação entre o ID do CRM e o ID correspondente na plataforma externa.
- `integration_outbox`: eventos transacionais de saída, com chave de idempotência e reprocessamento.
- `integration_inbox`: eventos recebidos, com ID externo único, hash do corpo e registro de validação de assinatura.
- `trg_enqueue_sale_integration_event`: cria eventos de venda apenas para conexões ERP ativas e configuradas pelo backend.

## Contrato inicial de eventos

Versão do contrato: `1`.

Eventos preparados:

- `sale.created`
- `sale.updated`
- `sale.archived`

O evento de venda contém somente os identificadores e dados comerciais necessários para iniciar a sincronização: venda, cliente, data, valor, moeda, produto/serviço, origem e horário da alteração. Observações, CNPJ, telefone e e-mail não são copiados para a fila. Se um conector precisar desses dados, o backend deve buscá-los no momento do envio com autorização da organização e registrar essa finalidade.

## Fluxo do primeiro conector

1. O administrador prepara a integração no painel.
2. Um conector específico define os campos aceitos pelo fornecedor e o sistema de origem de cada informação.
3. Credenciais são cadastradas somente como segredo do backend ou no Vault; nunca no React, em variáveis `VITE_`, nas tabelas públicas ou em logs.
4. O backend testa a conexão e, somente depois, marca `credentials_configured = true` e `status = active`.
5. A fila envia cada evento usando `idempotency_key`.
6. O ID retornado pelo fornecedor é gravado em `integration_external_links`.
7. Webhooks validam assinatura antes de salvar o evento recebido. Eventos repetidos são ignorados pela chave externa única.
8. Falhas temporárias usam novas tentativas com espera progressiva; falhas definitivas vão para `dead_letter` e exigem revisão.

## Regras de segurança obrigatórias

- Toda consulta e alteração deve carregar `organization_id`; confiar apenas no ID do registro é proibido.
- Somente proprietário, administrador da empresa ou administrador do sistema visualiza a preparação da conexão.
- Usuários autenticados não ativam conexões nem alteram credenciais ou dados operacionais diretamente.
- O backend deve usar lista permitida de destinos por conector. Nunca deve chamar uma URL arbitrária informada pelo usuário.
- Webhooks públicos precisam de assinatura HMAC ou mecanismo equivalente, tolerância curta de horário e proteção contra repetição.
- Respostas e logs devem remover tokens, senhas, cabeçalhos de autorização, documentos e dados pessoais não necessários.
- A chave `service_role` fica exclusivamente no servidor. O navegador usa apenas a chave publicável com RLS.
- Mudanças no contrato criam uma nova `event_version`; integrações existentes não devem ser quebradas silenciosamente.

## Limites desta versão

Esta fundação não conecta nem envia dados a qualquer ERP. A ativação depende da escolha do primeiro fornecedor, acesso à documentação oficial da API, credenciais de teste e definição do mapeamento de campos. Isso evita implementar uma integração genérica insegura ou que não corresponda ao ERP realmente usado pelos clientes.
