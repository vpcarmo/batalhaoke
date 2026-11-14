# Auditoria Pulso — cenários e responsividade da TV

Data: 14/11/2026. Implementação local, sem commit, push ou deploy.

## Inventário e matriz de associação

Inspeção anterior às alterações: `PULSO_REDESIGN.md`, `PULSO_ASSETS.md`, `src/routes/tv.tsx`, `src/styles.css`, `ArenaBackdrop.tsx`, `SessionQr.tsx`, `PlaybackPlayer.tsx`, referências e inventário completo de `public/`. Os prompts documentam **três cenários**, não uma imagem exclusiva para cada estado. Não foram encontrados os PNG de origem no repositório; os derivados finais são 1920×1080.

| Imagem | Arquivo em `public/images/brand/` | Estado previsto nos documentos/prompts | Estado antes desta alteração | Estado implementado |
| --- | --- | --- | --- | --- |
| Arena de espera | `pulso-arena-waiting.webp` e `.jpg` | Abertura, espera e preparação geral; centro livre para informações | Abertura da TV pareada sem sessão; Livre inicial e intervalo; espera genérica; Campeonato, inclusive votação | Abertura, Livre inicial/intervalo e espera do Campeonato. Votação eliminatória do Campeonato passa ao duelo |
| Arena de duelo | `pulso-arena-duel.webp` e `.jpg` | Confronto A azul/B lilás, nomes e VS | Preparação/arena X1 e votação direta A/B, sem player | Mesmos estados X1 e votação eliminatória do Campeonato sem player, cuja composição existente já identifica A/B e confronto |
| Arena de vitória | `pulso-arena-victory.webp` e `.jpg` | Vencedor e placar, iluminação dourada | Rei da mesa X1 sem confronto aberto; Campeonato concluído | Mesmas associações. `data-scene` agora corresponde à imagem de vitória, antes indicava `duel`/`waiting` |

**Sem cenários órfãos:** os três já tinham referências e continuam utilizados. As versões JPEG são alternativas de compatibilidade, portanto não precisam carregar junto do WebP. Não foram inventados cenários para estados técnicos.

Também foram inventariados `favicon.svg`, `favicon.png`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` e `icon-512-maskable.png`. São identidade do navegador/instalação, não cenografia. Links do documento usam SVG/ICO e apple-touch; o manifesto usa os três ícones instaláveis. `favicon.png` é um derivado sem referência explícita na UI atual, sem associação prevista a estado da TV. Fontes e suas licenças não são imagens.

| Momento | Cenário efetivo após ajuste |
| --- | --- |
| Abertura/boas-vindas e TV pareada aguardando sessão | Espera |
| Apresentação em andamento, inclusive X1 e Campeonato | Nenhum cenário: composição sólida, player integral e atribuição abaixo, conforme plano Pulso |
| Intervalo Livre | Espera, com última apresentação/destaque já existentes |
| Preparação do X1 / disputa sem apresentação ativa | Duelo |
| Votação X1 após ambas as apresentações | Duelo; placar/contagem originais |
| Votação durante a apresentação | Player e painel sólido; sem imagem sobre o player |
| Campeonato aguardando/grupos/preparação | Espera |
| Campeonato em votação eliminatória sem player | Duelo |
| Rei da mesa X1 sem confronto aberto / Campeonato concluído | Vitória |
| Pareamento, TV desabilitada, conexão inicial, sessão com TV desativada | Fundo sólido original; nenhum cenário específico previsto |
| Falha de sincronização durante sessão | Mensagem original e cenário calculado a partir do estado disponível; não se alterou a política de sincronização |

A escolha de vitória X1 continua limitada ao estado calculado originalmente: não se alterou o comportamento de sessão X1 finalizada, avanço de confronto ou definição de campeão. O cenário de Campeonato concluído também depende do estado que já chega ao componente.

## Problemas encontrados e correções

- Imagem a 48% de opacidade, grandes superfícies a 94% de opacidade e cards sólidos escondiam o palco. A imagem agora mantém suas cores, com gradiente discreto nas bordas e superfícies locais a 65–72% onde há texto.
- O fundo já usava `cover`; foi preservado e explicitado o foco central. A camada cobre **100% do viewport**, ultrapassando a meta aproximada de 90% para a composição do palco. Isso mede cobertura do cenário, não porcentagem de pixels livres de texto/QR. Os conteúdos usam margens laterais de 2,5%, preservando 95% de largura útil. Em retrato há corte lateral proporcional, centrado no palco; nenhuma distorção.
- A grade de apresentação permanecia lateral mesmo em 320px. Em retrato, player acima e identificação abaixo, com QR lateral à identificação. Em paisagem curta, duas colunas e vídeo dimensionado pela altura disponível.
- QR, tipografia, paddings e grids agora respondem a largura, altura e orientação. Duelo e resultado usam composições compactas nas menores telas. Nomes quebram dentro de trilhas `minmax(0,1fr)`; título da música pode quebrar sem o corte anterior de duas linhas.
- Viewports UHD a partir de 3000×1500 recebem escala visual 2×, para preservar a leitura equivalente a Full HD. Usa `zoom`, disponível em Chromium legado, com alternativa por `transform` dentro de `@supports`. A regra dimensiona a composição externa; não troca, duplica ou remonta o player. O viewport 3840×2160 foi recapturado e inspecionado após esse ajuste.
- O conteúdo deixou de encolher abaixo da altura intrínseca: mensagens excepcionais podem exigir rolagem, sem invadir cabeçalho, QR ou botão de áudio. Não se usa ocultação para mascarar conteúdo excedente.
- O card técnico da TV já estava ausente das apresentações. Essa separação foi preservada: permanece apenas nos estados técnicos onde já era renderizado.
- A votação eliminatória do Campeonato usava espera apesar da composição A/B já existente; agora compartilha duelo. A sinalização `data-scene` foi unificada com a imagem realmente escolhida.

## Fallback e compatibilidade

Cada cenário mantém WebP e JPEG real. O `picture` anterior atendia ausência de suporte WebP, mas não erro HTTP/decodificação do formato escolhido. Agora o erro remove a fonte WebP e tenta JPEG. Se o JPEG também falhar, a imagem é removida e a cor `#08121F` permanece. O estado interno de erro é reiniciado pela chave do cenário; não interfere na chave do player.

Foram preservados valores CSS tradicionais antes de `clamp()`/`dvh`, cores hexadecimais, regras fora de `@layer`, a proporção 16:9 legada e o alvo `es2018`/`chrome68`. Não foram adicionados filtros, animações, fundos em vídeo ou dependências. A regra que usa `:has()` tem equivalente pela classe já existente na rota; a composição não depende desse seletor.

## Preservação funcional e reprodução

Somente `tv.tsx`, `styles.css` e `ArenaBackdrop.tsx` tiveram código de aplicação alterado. Nenhum módulo de servidor, hook, migration, schema, política, autorização, Realtime, telemetria ou regra comercial foi alterado.

A comparação por AST com o HEAD registra:

- JSX completo do `PlaybackPlayer`, incluindo key, props, ref e callbacks: idêntico;
- ancestrais `section → div → div → main`: idênticos;
- chamadas de hooks da rota: idênticas;
- arquivo `PlaybackPlayer.tsx`: sem alterações.

Não há renderizações alternativas do player por breakpoint. A mudança de layout é CSS. Evidência reproduzível em `artifacts/pulso-tv/technical-audit.mjs` e resultados em `technical.json`.

## Método e evidências

`artifacts/pulso-tv/visual-audit.mjs` abre a rota real no Chrome local com fixtures HTTP interceptadas. Todas as Server Functions são respondidas no navegador; requisições HTTP externas e WebSockets são bloqueados. Nenhuma fixture chama banco, cria sessão, lança voto ou concede autorização comercial. As tentativas de reprodução são negadas deliberadamente; a captura mostra o bloqueio real do componente, e não uma reprodução autorizada simulada.

As capturas não comprovam leases, heartbeats, consumo de 30 segundos, áudio, reprodução comercial ou homologação de vencedor. São evidências da composição com dados controlados. Uma sondagem inicial do protocolo encontrou a ausência local de `SUPABASE_SERVICE_ROLE_KEY`; nenhuma configuração de produção foi modificada para contornar isso.

Os arquivos de imagem seguem `<estado>-<largura>x<altura>.png`. A [galeria de capturas](../artifacts/pulso-tv/gallery.html) agrupa as capturas por resolução. [responsive.json](../artifacts/pulso-tv/responsive.json) registra cenário, imagem, rolagem e retângulos; [technical.json](../artifacts/pulso-tv/technical.json) registra os códigos de saída reais, evitando confundir avisos no stderr com falha de ferramenta. As 14 folhas de contato foram inspecionadas visualmente; os arquivos PNG preservam a resolução original para conferência de detalhes.

Há seis capturas adicionais com sufixo `-bottom.png`, documentando o acesso ao final das telas com bloqueio em 320×568, 568×320 e 800×360, com nome comum e longo. A matriz principal contém **176 PNGs** (168 estados + 2 fallbacks + 6 finais de rolagem). Com a validação complementar abaixo, o total entregue é **212 PNGs**. Na revisão dos fallbacks também foram conferidos os caminhos SVG pretos/brancos e o formato quadrado do QR: 196×196 px. A estabilização da captura foi aguardada para não registrar um frame de pintura incompleto.

As transições observadas na mesma página foram espera → duelo → vitória → apresentação → espera. A imagem correspondente apareceu em cada etapa e desapareceu na apresentação. O nó do player permaneceu idêntico ao redimensionar pelas 14 dimensões. Esses resultados estão no final de `responsive.json`; a repetição dos fallbacks com detalhes do QR está em `responsive-fallback.json`.

## Validação física pendente

É necessária homologação em webOS/Smart TVs/TV Boxes reais: JPEG/WebP e recuperação após erro, fontes, overscan, viewport efetivo, foco/controle remoto, leitura de QR à distância, áudio inicial, reprodução prolongada, buffering/seek e reconexão. Chrome moderno e AST não substituem teste de reprodução autorizada em hardware. A arte original tem 1920×1080; a saída 4K a amplia proporcionalmente, sem criar detalhe adicional.

## Resultado final por resolução

12 estados por resolução: abertura, pareamento, espera, intervalo, preparação X1, duelo, votação X1, vitória X1, votação do Campeonato, resultado do Campeonato, apresentação bloqueada e apresentação bloqueada com nome longo.

| Resolução | Capturas | Rolagem horizontal / sobreposição | Rolagem vertical |
| --- | ---: | --- | --- |
| 320×568 | 12 | Nenhuma | live, long-live (mensagem de bloqueio) |
| 360×800 | 12 | Nenhuma | Nenhuma |
| 390×844 | 12 | Nenhuma | Nenhuma |
| 430×932 | 12 | Nenhuma | Nenhuma |
| 568×320 | 12 | Nenhuma | live, long-live (mensagem de bloqueio) |
| 800×360 | 12 | Nenhuma | live, long-live (mensagem de bloqueio) |
| 844×390 | 12 | Nenhuma | Nenhuma |
| 932×430 | 12 | Nenhuma | Nenhuma |
| 768×1024 | 12 | Nenhuma | Nenhuma |
| 1024×768 | 12 | Nenhuma | Nenhuma |
| 1366×768 | 12 | Nenhuma | Nenhuma |
| 1280×720 | 12 | Nenhuma | Nenhuma |
| 1920×1080 | 12 | Nenhuma | Nenhuma |
| 3840×2160 | 12 | Nenhuma | Nenhuma |

Total: **168 capturas de estados**, mais duas capturas de fallback; **0 transbordamentos horizontais**, **0 sobreposições entre cabeçalho/conteúdo/áudio**, **0 divergências de cenário**, **0 desvios da proporção 16:9** nos dados controlados. A resolução 1920×1080 atende TV e desktop; as quatro dimensões móveis também foram verificadas invertidas em paisagem.

Nas menores dimensões, as mensagens de bloqueio e o nome longo podem exigir rolagem vertical. Essa rolagem preserva o acesso à informação e ao botão de áudio; não caracteriza reprodução autorizada. Todos os estados normais sem player foram ajustados para caber nas resoluções testadas. Conteúdo excepcional arbitrariamente longo continua podendo ampliar a área rolável, em vez de ser escondido.

## Testes técnicos finais

| Verificação | Resultado |
| --- | --- |
| TypeScript | Passou, código 0 |
| Testes unitários existentes | 13 arquivos, 131 testes, código 0 |
| Build de produção | Passou, código 0; avisos de depreciação/configuração existentes |
| ESLint dos TSX envolvidos | Passou, código 0 |
| Formatação dos três arquivos de aplicação | Passou, código 0 |
| `git diff --check` | Passou, código 0 |
| Integração de convites | Não iniciou: falta `OPERATOR_INVITES_TEST_DATABASE_URL` local descartável |
| Integração comercial | Não iniciou: falta `COMMERCIAL_TEST_DATABASE_URL` local descartável; também requer fixtures próprias |

A contagem unitária coincide com o estado anterior documentado em `PULSO_REDESIGN.md`: 13 arquivos/131 testes. A comparação funcional com o HEAD está em `technical.json`. Não foram corrigidos avisos preexistentes de build nem alteradas configurações para mascarar resultados. O ESLint não define validação de CSS neste projeto; CSS foi verificado pelo Prettier, build e inspeção visual.

## Validação complementar

A continuação acrescentou **36 capturas**, com seis casos em 320×568, 568×320, 768×1024, 1280×720, 2560×1080 (ultralargo) e 3840×2160:

- nomes extensos de ambos os participantes na votação X1;
- música com título de 147 caracteres, sem truncamento;
- espera da fase de grupos do Campeonato, com cenário de espera;
- TV desabilitada, com fundo técnico sólido;
- TV desativada para a sessão, com identificação técnica preservada;
- falha na preparação do pareamento, com mensagem original.

[Galeria complementar](../artifacts/pulso-tv/gallery-supplement.html) · [Medições complementares](../artifacts/pulso-tv/responsive-supplement.json) · [Resumo](../artifacts/pulso-tv/supplement-summary.json). As seis folhas de contato complementares também foram inspecionadas.

Resultado: **0 transbordamentos horizontais**, **0 sobreposições**, **0 divergências de cenário**, **0 desvios quadrados de QR** e **0 desvios 16:9 do player**. O mesmo nó do player permaneceu presente ao alternar essas seis dimensões, incluindo a entrada/saída da escala UHD já finalizada.

O caso de título extenso com bloqueio comercial exige rolagem interna em 320×568, 568×320 e 1280×720. Os demais casos complementares cabem sem rolagem. Não se ocultou o título para forçar uma aprovação visual. Nenhuma autorização de reprodução foi simulada e nenhuma gravação remota foi realizada.

A continuação alterou somente o roteiro de auditoria, as galerias e este relatório. Não houve nova alteração nos três arquivos de aplicação já verificados por TypeScript, 131 testes, build e ESLint. As limitações de aparelhos físicos e bancos descartáveis permanecem.
