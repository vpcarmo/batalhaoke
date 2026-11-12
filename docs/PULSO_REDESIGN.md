# BatalhaOkê — Pulso, competição em transmissão

Implementação local de 11/11/2026. Sem commit, push ou deploy. A referência estrutural usada foi o HEAD da branch `main`, que estava limpa no início.

## Entrega

Identidade compartilhada em azul-marinho, turquesa e violeta, com dourado reservado a prestígio e resultados. A TV recebe cenografia própria; a operação usa superfícies sólidas, controles legíveis e organização responsiva.

- Home: largura máxima de 1152 px, operação e gestão em duas áreas no desktop, uma coluna no celular, estabelecimento identificado no contexto operacional.
- Sessão: largura ampliada e divisão entre apresentação atual e fila no desktop; apresentação atual com indicador lateral; busca musical adaptada a telas pequenas. Ordenação, favoritos, histórico e avanço preservados.
- TV: abertura com as três chamadas aprovadas; cenários de espera, duelo e vitória; identificação técnica removida do espetáculo e preservada nos estados técnicos. X1 com A azul e B lilás, resultado dourado, cronômetro existente e QR. Campeonato apresenta título, fase, confronto e votos existentes. Vitória em 720p reorganizada em grade para caber no viewport.
- Apresentação ao vivo: player único, painel lateral, QR e atribuição preservados. Nenhuma imagem de arena é montada durante esse estado. Dimensionamento externo reserva espaço para atribuição, mensagens de bloqueio e ativação de áudio.
- Votação: ações grandes, opção principal turquesa, alternativas A/B equilibradas com identificação textual e cromática. Inscrição e Login recebem fontes, campos, foco e associação das mensagens ao formulário.
- Campeonato: título legível, hierarquia das seções, superfícies e identidade de torneio, sem mudanças nas fases ou decisões.
- SuperAdmin: largura ampliada, navegação por âncoras para contextos existentes, superfícies administrativas e números tabulares.
- Financeiro: plano, trial, consumo e carteira antes das ofertas; apresentação dos valores preservada; `window.alert` substituído pelo Sonner compartilhado.
- Gestão de TVs e operadores: tipografia, controles, superfícies e adaptação mobile; confirmações e permissões existentes preservadas.
- QR: moldura e tipografia harmonizadas; fundo branco e zona silenciosa de quatro módulos no código, além do padding externo. Impressão preservada.
- Identidade externa: símbolo do microfone preservado, SVG/PNG/ICO e ícones instaláveis harmonizados, manifesto e `theme-color` em azul-marinho. Erros e 404 em português.

## Paleta

| Função                                | HEX                                           |
| ------------------------------------- | --------------------------------------------- |
| Fundo                                 | `#08121F`                                     |
| Superfície                            | `#111E30`                                     |
| Elevada                               | `#1A2B42`                                     |
| Bordas                                | `#40536E`                                     |
| Texto                                 | `#F5F8FC`                                     |
| Texto secundário                      | `#A8B5C9`                                     |
| Principal / hover / pressionado       | `#45E0CF` / `#6DEBDD` / `#2DC3B4`             |
| Texto sobre ação                      | `#07111F`                                     |
| Espetáculo                            | `#A78BFA`                                     |
| Competidor A / B                      | `#7AC7FF` / `#E6ACFF`                         |
| Campeão                               | `#F4D17A`                                     |
| Sucesso / atenção / erro / informação | `#69DEA5` / `#FFD27A` / `#FF8B98` / `#7AC7FF` |
| Desabilitado                          | `#26354A`                                     |
| Borda de campo acessível              | `#607593`                                     |

A borda de campos usa uma derivação mais clara, com contraste de 3,56:1 sobre a superfície. A borda decorativa oficial é mantida nos cards.

## Fontes e tokens

WOFF2 oficiais de Barlow Condensed 600/700 e Source Sans 3 400/600/700, com subconjuntos latin e latin-ext, em `public/fonts/`. Folha local `public/fonts/fonts.css`, `font-display: swap`, fallbacks de sistema e fallback Arial com métricas. Não há requisição a Google Fonts durante a operação.

Origem da distribuição: [Google Fonts CSS2](https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap). Licenças preservadas em `BarlowCondensed-OFL.txt` e `SourceSans3-OFL.txt`, provenientes de [Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed) e [Source Sans 3](https://github.com/google/fonts/tree/main/ofl/sourcesans3).

Tokens em `src/styles.css`: cores de superfície e semântica, competidores, ação/hover/pressionado, foco, desabilitado, espaços 4–32 px, controles 36/44/52/64 px, raios, sombras, durações, escala 12/14/16/18/24/32/40 px e entrelinhas correspondentes. A escala é ligada às utilidades Tailwind. Tokens de TV: apoio 24, música 32, participante 64, chamada 80 e placar 112 px, com adaptação a 720p. Nomes longos têm quebra e redução controlada.

Componentes padronizados: Button, Input, Textarea, Select, Badge, Card, Table, Dialog, Sheet, Alert e Sonner. Badge oferece neutro, ativo, sucesso, atenção, erro, informação, A, B e campeão. Card oferece resumo, operação, configuração, informação, destaque e resultado, com `asChild` para preservar os elementos semânticos. Alert oferece variantes para sucesso, atenção, informação, bloqueio, carregamento, vazio e confirmação, além das existentes. Diálogos e sheets têm limites de altura e rolagem interna.

## Cenários

Gerados com a ferramenta integrada `image_gen`, conforme a skill `imagegen`; nenhuma API externa de geração foi utilizada. Os PNG originais foram inspecionados e convertidos em ativos 1920×1080. A aplicação usa `picture` com WebP e fallback JPEG real, carregando o cenário do estado atual. Camadas de leitura pertencem somente aos estados sem player.

| Arquivo em `public/images/brand/` |          WebP |          JPEG |
| --------------------------------- | ------------: | ------------: |
| `pulso-arena-waiting`             | 159.400 bytes | 192.109 bytes |
| `pulso-arena-duel`                | 187.332 bytes | 223.173 bytes |
| `pulso-arena-victory`             | 196.578 bytes | 230.058 bytes |

Cada linha corresponde aos arquivos `.webp` e `.jpg`. Prompts completos em [PULSO_ASSETS.md](PULSO_ASSETS.md).

## Verificação

| Verificação                       | Resultado                                                              |
| --------------------------------- | ---------------------------------------------------------------------- |
| TypeScript — `tsc --noEmit`       | Passou                                                                 |
| Vitest — suíte existente completa | 13 arquivos, 131 testes passaram                                       |
| Build de produção — Vite          | Passou, código 0                                                       |
| ESLint direcionado                | Nenhuma infração nova comparada ao HEAD                                |
| `git diff --check`                | Passou                                                                 |
| Contraste calculado               | 73 combinações, mínimo 4,85:1, nenhuma abaixo de 4,5:1                 |
| Player — arquivo                  | Idêntico ao HEAD                                                       |
| Player — montagem na TV           | Mesmas props, key, condição e cadeia de ancestrais, comparadas por AST |

O ESLint ainda retorna o erro preexistente `no-useless-escape` no script de polyfills de `__root.tsx` e três avisos preexistentes de Fast Refresh em Button, Badge e SessionQr. Foram comparados com o HEAD; não foram alterados para mascarar o resultado. O build também mantém avisos preexistentes sobre `inputValidator` e `vite-tsconfig-paths`.

As verificações foram chamadas diretamente pelos executáveis Node locais, pois os wrappers npm/npx inicialmente esbarraram em `EPERM` no diretório do usuário.

Os testes de integração existentes de convites e de concorrência comercial foram tentados, mas não puderam iniciar: faltam `OPERATOR_INVITES_TEST_DATABASE_URL` e `COMMERCIAL_TEST_DATABASE_URL` apontando para bancos locais descartáveis; o segundo também exige fixtures. Nenhum banco foi criado nem alterado para contornar isso.

Contrastes incluem texto principal/secundário e cores semânticas nas três superfícies, ações normais/hover/pressionadas, ações com transparência, estados desabilitados e fundos de status. Os resultados estão em `artifacts/pulso/contrast.json`. Isso não equivale a uma certificação WCAG de todas as combinações possíveis de dados e estados.

Evidências em `artifacts/pulso/`: `code-audit.json`, `contrast.json`, `build.log` e 17 screenshots. Foram revisadas Home desktop/320 px, Login, QR e 404; votação em 320/390/430 px; abertura da TV em 1920×1080 e 1280×720; espera, X1, votação direta, vitória, final, pareamento e composição de reprodução/bloqueio. Não houve rolagem horizontal nos casos móveis capturados, nem rolagem da página nos estados de TV capturados.

Os dados de TV e votação das capturas são fixtures interceptadas somente pelo navegador de revisão, sem gravações remotas. A captura de reprodução mostra o bloqueio comercial preservado; não foi executada uma reprodução comercial autorizada real. Telas administrativas autenticadas não foram homologadas com contas reais nesta execução.

## Compatibilidade e preservação

Mantido o alvo de build `es2018`/`chrome68`. Tokens em hexadecimal, alturas `100vh` antes de `100dvh`, valores anteriores a `clamp()`, regras externas a `@layer` para TV legada, dimensão 16:9 legada e foco por `:focus` continuam disponíveis. Não foi introduzida dependência de `backdrop-filter`; o blur da barra operacional foi removido. Movimento reduzido respeitado.

Não houve homologação física em webOS/Smart TV. Ainda precisam de teste no dispositivo: renderização de fontes, overscan, viewport CSS real, leitura do QR à distância, controle remoto/foco, áudio inicial, reprodução prolongada, pausa/buffering/seek, reconexão, prioridade TV, leases e contabilização de 30 segundos. O navegador moderno usado para screenshots não substitui Chromium 68 real. Dados extremos, teclado virtual e todos os estados autenticados também exigem validação em seus ambientes de uso.

**A lógica funcional e comercial foi preservada.** Não foram modificados módulos de servidor, autenticação, funções comerciais, telemetria, registry/provedores, medições, migrations, schema, testes existentes ou configurações de build. `PlaybackPlayer.tsx` ficou intacto; sua instância não foi duplicada e seu bloco de montagem continua equivalente. Votos, tokens, inscrições, permissões, preços, planos e Mercado Pago mantêm seus fluxos. A mudança de feedback do Financeiro usa o Sonner já existente, preservando ações e redirecionamentos.

## Arquivos

- Sistema: `src/styles.css`, `src/routes/__root.tsx`.
- UI: `src/components/ui/{alert,badge,button,card,dialog,input,select,sheet,sonner,table,textarea}.tsx`.
- Competição: `src/components/karaoke/{ArenaBackdrop,MusicSearch,SessionQr,X1Matches}.tsx`.
- Rotas: `index.tsx`, `tv.tsx`, `sessao.$id.tsx`, `votar.$code.tsx`, `qr.$code.tsx`, `login.tsx`, `inscrever.$id.tsx`, `campeonatos.tsx`, `campeonatos.$id.tsx`, `estabelecimento.$venueId.operadores.tsx`, `financeiro.tsx`, `superadmin.tsx`.
- Identidade: `public/favicon.{svg,png,ico}`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`, `public/manifest.webmanifest`.
- Novos ativos: `public/fonts/*`, `public/images/brand/pulso-arena-{waiting,duel,victory}.{webp,jpg}`.
- Documentação/evidências: este relatório, `docs/PULSO_ASSETS.md`, `artifacts/pulso/*`.
