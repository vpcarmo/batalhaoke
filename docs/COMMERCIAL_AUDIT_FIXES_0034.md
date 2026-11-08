# Correções da auditoria comercial — 0034

## Entrega

As migrations 0027–0033 foram preservadas. A 0034 é incremental, transacional e destinada à execução manual no SQL Editor do Lovable Cloud. Não altera `billing_enabled`, credenciais ou secrets. Não houve aplicação remota, commit, push ou deploy nesta tarefa.

1. **Estabelecimentos no Trial:** limite resolvido por override da conta, assinatura ativa e, na ausência desta, Trial ativo dentro de `starts_at`/`ends_at`. `commercial_settings.trial_venue_limit` inicia em 1, aceita valores positivos e pode ser administrado na tela Superadmin. O bloqueio da linha da conta serializa criações concorrentes antes da contagem. Contas com cobrança desativada continuam dispensadas do limite comercial.
2. **Fatura atual:** seleção por `debit_date`, com fallback para `date_created`, independentemente da ordem da lista. Datas ausentes/ambíguas interrompem a verificação. Somente o pagamento da fatura selecionada é consultado; seu identificador vem de `payment.id`, não do ID da fatura. Aprovações de ciclos anteriores não quitam o atual. O vencimento da assinatura delimita o ciclo; na sua ausência, usa-se a data de inadimplência. Aprovações são encaminhadas à função idempotente existente. Lista vazia, campos insuficientes e erros não geram estados presumidos. A verificação anterior é invalidada antes da consulta, evitando suspensão com informação antiga após erro.
3. **Reprodução:** o trigger de ativação cria a medição e confirma a reserva na mesma transação da mudança de status, cobrindo Livre e fluxos de disputa. A API confirma no banco se a conta está sujeita à cobrança e se existe autorização. O player local e a TV aguardam essa confirmação antes de montar o provedor. Falhas comerciais interrompem o player e apresentam mensagem; respostas atrasadas não reabrem uma autorização revogada. Um prazo conservador de 12 segundos, descontando o tempo da requisição, impede continuar indefinidamente sem heartbeats confirmados. Uma dispensa comercial precisa ser confirmada explicitamente pelo servidor. As regras existentes de 30 segundos acumulados, prioridade da TV e liberação na finalização foram preservadas.
4. **Cron exclusivo:** tabela com RLS, RPCs restritas a `service_role`, aquisição atômica, token UUID e expiração de dois minutos. A execução renova a trava entre operações e a libera em `finally`. Concorrentes recebem HTTP 409 com `status: already_running`, antes de consultar contas ou Mercado Pago. Pagamentos, verificações e o processamento de lifecycle conferem o token dentro da própria transação, bloqueando escritas de uma execução substituída. As chamadas ao provedor têm timeout de 20 segundos.
5. **Textos:** reparação seletiva do mojibake financeiro, preservando trechos que já estavam corretos, com teste de UTF-8 válido e pesquisa de outros arquivos comerciais.
6. **Créditos:** `confirm_commercial_execution` aloca lotes positivos `purchase` e `grant` em FIFO por `created_at,id`, descontando alocações e estornos e excluindo lotes vencidos. O saldo é conferido sob bloqueio da conta. Ausência de lote provoca rollback, incluindo o débito e a qualificação. O débito acompanha a expiração do lote para evitar saldo negativo artificial quando ele expira. O processamento repetido reutiliza a identidade do consumo e não duplica alocações. Nenhum lançamento existente do ledger é alterado ou apagado.

Referência do formato de faturas consultada: [Mercado Pago — buscar em faturas](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get).

## Arquivos

| Arquivo | Alteração |
|---|---|
| `drizzle/migrations/0034_commercial_audit_fixes.sql` | Limite de Trial, autorização de reprodução, lotes consumíveis e trava/RPCs do Cron |
| `drizzle/migrations/meta/_journal.json` | Entrada 0034 |
| `src/components/karaoke/PlaybackPlayer.tsx` | Autorização antes da montagem e interrupção na perda de confirmação |
| `src/lib/commercial-playback.ts` | Mensagens e controle do prazo da autorização |
| `src/lib/commercial-playback.server.ts` | Confirmação obrigatória da autorização no banco |
| `src/lib/measurement.functions.ts` | Proteção compartilhada entre operador e TV |
| `src/lib/karaoke.functions.ts` | Propagação clara dos erros de ativação |
| `src/lib/commercial.functions.ts` | Configuração administrativa do limite de Trial e correção de textos |
| `src/routes/superadmin.tsx` | Campo de estabelecimentos no Trial |
| `src/routes/financeiro.tsx` | Correção de textos |
| `src/lib/commercial-cron.server.ts` | Seleção/verificação da fatura e ciclo de posse da trava |
| `src/routes/api.cron.commercial.ts` | Uso da trava e das RPCs protegidas por token |
| `src/lib/mercado-pago.server.ts` | Timeout nas chamadas ao provedor |
| `src/lib/commercial-audit.test.ts` | Regressões da auditoria |
| `docs/COMMERCIAL_AUDIT_FIXES_0034.md` | Relatório e sequência de aplicação |

## Validações

Os comandos abaixo usam as dependências já instaladas, sem Docker, PostgreSQL local ou acesso ao banco remoto:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/vitest/vitest.mjs run src/lib/commercial-audit.test.ts
node node_modules/vite/bin/vite.js build
node node_modules/eslint/bin/eslint.js src/components/karaoke/PlaybackPlayer.tsx src/lib/commercial.functions.ts src/lib/measurement.functions.ts src/lib/karaoke.functions.ts src/lib/commercial-playback.ts src/lib/commercial-playback.server.ts src/lib/commercial-cron.server.ts src/lib/commercial-audit.test.ts src/lib/mercado-pago.server.ts src/routes/financeiro.tsx src/routes/superadmin.tsx src/routes/api.cron.commercial.ts
git diff --check
```

Resultados finais em 08/11/2026:

| Validação | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | Passou, código de saída 0 |
| Vitest completo | 13 arquivos, 131 testes passaram |
| Testes específicos da auditoria | 26 testes passaram |
| Build de produção | Passou, código de saída 0, cliente e servidor gerados |
| ESLint direcionado | Passou, código de saída 0 |
| `git diff --check` | Passou, sem erros de whitespace |
| Pesquisa de mojibake nos arquivos comerciais | Nenhuma ocorrência nos arquivos de interface e funções verificados |
| Preservação das migrations 0027–0033 | Sem diferenças nesses arquivos |

O build emite avisos existentes de depreciação de `inputValidator` e da configuração de resolução de caminhos do Vite. Eles não impediram a compilação. O Git emite avisos de normalização LF/CRLF no Windows; não são falhas de whitespace. Os comandos foram executados diretamente pelos binários locais do Node, sem instalar dependências.

Os testes de RPC usam mocks. Os testes SQL verificam contratos estáticos, permissões declaradas, seleção de lotes, proteções e delimitadores; não executam PL/pgSQL. A revisão comparou tabelas, colunas, assinaturas, tipos e referências com as migrations existentes. Não foram executados testes reais de concorrência PostgreSQL, aplicação da migration, pagamentos reais/Sandbox ou reprodução em navegador/TV. Esses resultados dependem da validação no ambiente de destino. A migration não reescreve dados históricos do ledger.

## Sequência exata de aplicação e publicação pelo usuário

1. Encerrar as apresentações de teste em andamento e pausar temporariamente o agendamento do Cron comercial durante a atualização. Manter a cobrança global desativada.
2. Abrir o projeto correto no Lovable Cloud e seu SQL Editor. Copiar **todo** o conteúdo de `drizzle/migrations/0034_commercial_audit_fixes.sql`, incluindo `BEGIN` e `COMMIT`, e executar uma única vez, após as migrations 0030–0033 já aplicadas. Não reaplicar essas migrations antigas.
3. Confirmar sucesso da transação. Se houver erro, executar `ROLLBACK` se a sessão continuar em transação abortada, guardar a mensagem e não publicar o código dependente da 0034 antes de resolver o erro.
4. Conferir no SQL Editor, sem alterar configurações:

   ```sql
   SELECT billing_enabled, trial_venue_limit
   FROM public.commercial_settings WHERE id=true;

   SELECT c.relname, c.relrowsecurity
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='commercial_cron_lock';

   SELECT tgname FROM pg_trigger
   WHERE tgrelid='public.performances'::regclass
     AND tgname='performance_commercial_start' AND NOT tgisinternal;

   SELECT has_function_privilege('anon',
     'public.acquire_commercial_cron_lock(uuid)', 'EXECUTE') AS anon_lock,
     has_function_privilege('authenticated',
     'public.authorize_commercial_playback(uuid)', 'EXECUTE') AS client_authorize,
     has_function_privilege('service_role',
     'public.run_locked_commercial_lifecycle(uuid,integer)', 'EXECUTE') AS service_lifecycle;
   ```

   Esperado: limite inicial 1; `billing_enabled` com o valor anterior; RLS verdadeiro; trigger presente; permissões `false`, `false`, `true`.
5. Revisar o diff local e executar os comandos de validação acima. Fazer o commit e o push pelo fluxo habitual da branch conectada ao Lovable, preservando o histórico, e publicar a implementação pelo Lovable. Essas ações ficam a cargo do usuário; não foram realizadas nesta tarefa.
6. Recarregar as páginas do operador e da TV para retirar o player antigo da sessão. Reativar o agendamento do Cron após a publicação. Conferir que duas requisições autorizadas simultâneas retornam uma execução e uma resposta `409/already_running`, sem duas sequências de consultas ao provedor. A liberação normal remove a linha da trava; em interrupção, uma execução posterior pode adquiri-la após a expiração.
7. No ambiente de Sandbox já configurado, validar os seis cenários: Trial válido permite o primeiro estabelecimento e bloqueia o seguinte no limite; Trial expirado/revogado não concede limite; fatura atual rejeitada/pendente não é substituída por aprovação anterior; cota esgotada bloqueia ativação e reprodução local/TV; interrupção da confirmação bloqueia conta cobrada; menos de 30 segundos libera a reserva e 30 segundos acumulados gera um único consumo; créditos bonificados geram alocação FIFO e reprocessamento não duplica consumo. Conferir os textos financeiros.

As verificações que exercitam cobrança exigem um ambiente Sandbox em que ela já esteja habilitada para a conta e globalmente. Com a chave global desativada, o resultado esperado é a dispensa comercial e não o bloqueio por cota. Esta entrega não ativa essa chave nem configura o ambiente.
