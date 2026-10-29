# Checkpoints do roadmap de outubro/2026

Cada checkpoint é uma branch no GitHub (`checkpoint/N-...`). Para voltar a um ponto, peça: "volte o CRM para o checkpoint N".

| # | Branch | O que entrou |
|---|--------|--------------|
| 0 | checkpoint/0-antes-roadmap | Estado de antes de tudo |
| 1 | checkpoint/1-tela-mensagens | Mensagens: só campanha + título, abre ao clicar |
| 2 | checkpoint/2-tela-hoje | Tela "Hoje": alertas de risco, atrasados, hoje, próximos 7 dias |
| 3 | checkpoint/3-motivo-de-perda | Motivo de perda / não interesse |
| 4 | checkpoint/4-metas-relatorios | Metas por empresa e vendedor + relatórios |
| 5 | checkpoint/5-duplicados | Aviso de duplicados (aba na tela Hoje) |
| 6 | checkpoint/6-previsao | Previsão de vendas |
| 7 | checkpoint/7-cadencia-whatsapp | Cadência automática de WhatsApp (desligada por padrão) |

## Banco de dados (todas as mudanças são aditivas)
- `leads.loss_reason` (coluna nova)
- `sales_goals`, `forecast_settings`, `whatsapp_cadences` (tabelas novas, com RLS por empresa)
- `private.run_whatsapp_cadence()` + agendamento `axiva_whatsapp_cadence` (a cada 10 min; não faz nada enquanto nenhuma campanha tiver cadência ativa)
- Para pausar a cadência em emergência: `select cron.unschedule('axiva_whatsapp_cadence');`
