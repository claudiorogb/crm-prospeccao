# AXIVA CRM — Modelo de Trial e Contratação Paga

Documento de referência definido pelo dono do produto (07/10/2026). Vale para todo o desenvolvimento da cobrança.

## 1. Planos

| Plano | Valor mensal | IA/dia | Captação automática |
|---|---|---|---|
| AXIVA | R$ 45,00 | 10 | até 160 leads/mês |
| AXIVA Plus | R$ 79,80 | 20 | até 450 leads/mês |
| AXIVA Max | R$ 164,80 | 20 | até 900 leads/mês |

Cobrança recorrente mensal **por usuário**.

## 2. Primeiro acesso — Trial

- 30 dias, **1 Trial por CNPJ**.
- Fluxo: Cadastro → validação do CNPJ → contrato → aceite eletrônico → início do Trial.
- No aceite ficam registrados: CNPJ, usuário, e-mail, versão do contrato, data/hora do aceite, início e término do Trial.
- O Trial **não gera cobrança automática**.
- Os dados inseridos durante o Trial são preservados.

## 3. Fim do Trial

- Os dados **não** são apagados.
- Acesso restrito: pode visualizar o Kanban e baixar/exportar os dados comerciais; não pode usar o CRM normalmente.
- Para continuar, precisa contratar um plano.
- Alertas de contratação nos dias **10, 5, 4, 3, 2 e 1** antes do vencimento.

## 4. Contratação paga

Escolhe o plano → aceita o contrato → é direcionado ao Asaas → realiza o pagamento.

Tela de planos: AXIVA R$ 45,00/mês · AXIVA Plus R$ 79,80/mês · AXIVA Max R$ 164,80/mês. Cada botão leva ao checkout correspondente no Asaas.

## 5. Regra mais importante: pagamento não libera acesso sozinho

O frontend nunca libera o plano porque o cliente chegou ao checkout ou concluiu o checkout.

```
Cliente escolhe plano → Aceita contrato → Cria pedido → Checkout Asaas → Cliente paga
→ Asaas confirma pagamento (PAYMENT_CONFIRMED / PAYMENT_RECEIVED)
→ Webhook chega ao Supabase → Pedido = pago → Contrato = pago → Licença = ativa
→ Plano do usuário = ativo → CRM libera acesso
```

O webhook do Asaas (pagamento confirmado) é a **única** fonte de confirmação. Cartão recusado nunca pode liberar acesso.

## 6. Billing V2

O Billing anterior (V1) teve problemas; o Billing foi reescrito do zero sem mexer no CRM.

Funções: Billing V2 Sandbox, Billing V2 Webhook Sandbox, Billing V2 Production, Billing V2 Webhook Production.

**Sandbox primeiro. Produção somente depois que todo o fluxo estiver comprovadamente funcionando:**
Contrato → Checkout → pagamento → webhook → licença → usuário → Meu plano.

## 7. Usuários adicionais

- Administrador: Equipe → Adicionar usuário.
- O usuário adicional passa pelo processo de contratação/liberação definido para ele.
- O sistema controla a quantidade de usuários licenciados; a cobrança é vinculada à quantidade de usuários ativos da organização.

## 8. Alteração de plano

- Somente administrador/proprietário altera o plano; a mudança exige confirmação.
- **Upgrade:** cancela a assinatura anterior, cria a nova, aplica pró-rata, mantém organização e dados.
- **Downgrade:** vale no próximo ciclo (não perde o período já pago).

## 9. Cancelamento

- Encerra a assinatura e a cobrança recorrente.
- Licença suspensa/restrita conforme o ciclo.
- Dados comerciais da empresa **não** são apagados.

## 10. Inadimplência

- Inadimplência do administrador bloqueia ele e os usuários que ele adicionou (só visualizar Kanban e baixar dados).
- Ao pagar, o acesso é reativado.

## 11. CNPJ já existente

Cadastro → CNPJ encontrado → usuário vinculado à organização existente → aguardando aprovação do administrador → administrador aprova → acesso liberado. Nunca cria outra empresa com o mesmo CNPJ.

## 12. Separação fundamental

```
                    AXIVA CRM
          ┌─────────────┴─────────────┐
        TRIAL                    BILLING V2
   30 dias, 1 por CNPJ        Contratação paga
   Sem cobrança                 Asaas → Webhook
   Dados preservados            Licença ativa
   Acesso restrito ao vencer
          └──────────────┬────────────┘
                    CRM liberado
```

Trial e Billing V2 permanecem separados. O Billing V2 não pode alterar nem quebrar o Trial.

## 13. Princípio geral

- O que já funciona fica congelado.
- Só se altera o ponto comprovadamente responsável pelo problema (diagnosticar → menor alteração → testar).
- Concluído só depois de o dono testar e confirmar.
- Nada vai para produção sem o dono dizer "pode publicar".
