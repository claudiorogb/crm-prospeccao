# Checkpoint da cobrança — 07/10/2026

Ponto de retorno antes de mexer na cobrança (Billing V2). Nada aqui é usado pelo app.

## Código do site
- Tag git `checkpoint-cobranca-20261007` = commit `bd0183a` do `main` (o que está em produção em crm.axiva.com.br).

## Banco (Supabase lhnzpxjjfalxmlkjysor)
- Schema `checkpoint_cobranca_20261007`: cópia das tabelas de cobrança, planos, organizações, membros e perfis
  (axiva_asaas_config, axiva_asaas_webhook_events, axiva_billing_*, axiva_billing_v2_*, axiva_paid_contract_acceptances,
  axiva_trial_terms_acceptances, axiva_user_billing, crm_plans, user_plan_assignments, user_plan_usage_monthly,
  organizations, organization_members, organization_access_requests, profiles). Sem acesso pela API (anon/authenticated revogados).
- Última migration aplicada: `20261006173754 billing_v2_plan_change_fields`.

## Edge Functions de cobrança (versão no momento do checkpoint)
| Função | Versão |
|---|---|
| billing-v2-sandbox | v13 |
| billing-v2-webhook-sandbox | v4 |
| billing-v2-production | v1 |
| billing-v2-webhook-production | v1 |
| create-asaas-checkout / -sandbox | v20 / v14 |
| asaas-webhook / -sandbox | v13 / v20 |
| manage-asaas-billing / -sandbox | v8 / v6 |
| asaas-billing-next-checkout | v2 |
| signup-with-resend | v13 |
| invite-org-user | v20 |

O código das 4 funções Billing V2 está em `supabase-functions/`. As demais não serão alteradas sem antes
salvar uma cópia aqui.
