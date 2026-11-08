# Camada comercial SaaS

## Aplicação das migrations

Aplicar manualmente no Lovable Cloud SQL Editor, após confirmar a migration 0029, nesta ordem:

1. `drizzle/migrations/0030_commercial_foundation.sql`
2. `drizzle/migrations/0031_commercial_atomicity.sql`
3. `drizzle/migrations/0032_commercial_lifecycle.sql`
4. `drizzle/migrations/0033_commercial_operations.sql`

Nenhuma migration foi aplicada remotamente. Cobrança global/por conta permanece desativada por padrão; planos iniciais permanecem em draft.

## Trials e inadimplência

`POST /api/cron/commercial` executa `process_commercial_lifecycle` com limite 100. A rotina usa horário PostgreSQL, `FOR UPDATE SKIP LOCKED`, resultado por conta, trilha de auditoria e reexecução idempotente. Não foi encontrado agendador integrado no repositório; configurar scheduler externo diário (por exemplo, 00:15 UTC) para chamar o endpoint com `Authorization: Bearer <CRON_SECRET>`. Definir `CRON_SECRET` como segredo server-side aleatório de ao menos 32 bytes. Sem segredo, o endpoint nega acesso.

O trigger de reserva também expira trial vencido antes da decisão e verifica estado de inadimplência/dívida; o agendador não é a única proteção. Falha de pagamento confirmada pelo fetch remoto marca `past_due`, registra início e `grace_ends_at` a partir de `commercial_settings.delinquency_grace_days`. O lote suspende após o prazo. A aprovação autoritativa limpa inadimplência e cria o período com chave única. O proprietário vê aviso, mantém acesso financeiro/pagamentos e pode regularizar.

O SuperAdmin pode ajustar ou estender vencimento e revogar trial ativo. Há confirmação explícita, justificativa obrigatória, bloqueio por linha, before/after e responsável. Trial expirado/revogado não pode ser reiniciado.

## Eventos e conta administrativa

O SuperAdmin lista eventos, tentativas, estado e erro e pode reprocessar evento individual. Reprocessamento requer assinatura previamente validada, autenticação SuperAdmin e referência; busca novamente o recurso no MP, serializa por recurso, grava o resultado e audita o administrador. Payload persistido é uma lista restrita de metadados (sem credenciais ou dados de cartão). A conta do proprietário continua isolada no endpoint financeiro.

## Reembolsos e chargebacks

Checkout Pro usa pagamento `/v1/payments/{id}`, reembolsos `/v1/payments/{id}/refunds` e chargeback `/v1/chargebacks/{id}` a partir do tópico `topic_chargebacks_wh`. Reembolso e chargeback só lançam compensação após consulta autoritativa. Reembolso parcial acumula cada ID externo e impede exceder o pagamento. Créditos são revertidos proporcionalmente pela fração cumulativa, arredondando para baixo e ajustando a última reversão integral para capturar o restante. Ledger original nunca é removido. Créditos já consumidos viram obrigação auditável; dívida aberta bloqueia novas execuções financiadas até regularização SuperAdmin auditada. Faturas recorrentes são registradas pelo ID e reavaliam a assinatura/franquia sem apagar consumo ou duplicar período. Cancelamento pendente usa estado cancelado e não é tratado como reembolso.

## Mercado Pago

O provider server-side usa `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_MODE` e `APP_URL`. `MERCADO_PAGO_MODE` deve ser explicitamente `sandbox` ou `production`; tokens não fazem fallback entre ambientes. Configure tópicos `payment`, `subscription_authorized_payment`, `subscription_preapproval` e `topic_chargebacks_wh`. O código atual não executa refund remoto: processa notificações/refundos já confirmados.

Referências oficiais consultadas:

- [Refund de pagamentos Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/create-refund/post)
- [Consultar chargeback](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/chargebacks/get-chargeback/get)
- [Notificações de chargebacks](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/chargebacks/notifications)
- [Faturas de assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview)

## Validação e dependências externas

Docker CLI está instalado, mas o daemon não está acessível neste host; `psql` também não está disponível. Não foram executados migrations nem testes concorrentes PostgreSQL. Não há credenciais MP no `.env`, então nenhum E2E sandbox foi executado. Testes com mocks não equivalem a validação E2E. Antes de habilitar cobrança, aplicar 0030–0033 em PostgreSQL descartável e executar concorrência real; configurar credenciais `TEST-`/sandbox e `MERCADO_PAGO_MODE=sandbox` para checkout, recusa, recorrência, reembolso, webhook e reprocessamento. Não forjar aprovação.

Foi adicionado um cenário concorrente reprodutível para trial expirado e suspensão de assinatura: prepare um PostgreSQL local isolado chamado, por exemplo, `batalhaoke_commercial_test`, aplique 0030–0033 e semeie apenas fixtures de teste vencidas. Defina `COMMERCIAL_TEST_DATABASE_URL`, `COMMERCIAL_TEST_EXPIRED_TRIAL_ID` e `COMMERCIAL_TEST_OVERDUE_SUBSCRIPTION_ID`, então execute `node tests/commercial-postgres-lifecycle-concurrency.mjs`. O script rejeita hosts remotos, Supabase e nomes de banco que não incluam `commercial_test`. Outros oito cenários de concorrência comercial ainda dependem de fixtures e execução em PostgreSQL real.

Para o scheduler: configurar `CRON_SECRET` no ambiente server-side e agendamento HTTPS diário chamando `/api/cron/commercial` com o header Bearer. Nenhuma extensão `pg_cron`/`pg_net` foi presumida ou habilitada.
