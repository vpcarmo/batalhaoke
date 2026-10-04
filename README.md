# BatalhaOkê

Quero iniciar um novo projeto chamado provisoriamente Karaoke Arena.
O objetivo é criar uma plataforma de karaokê interativo para bares, restaurantes, festas, eventos e outros ambientes com público.
O diferencial será combinar:
reprodução de músicas/playbacks;
cadastro simples de cantores;
apresentações;
votação do público;
controles físicos ESP32 Super Mini;
resultados em tempo real;
futuramente duelos, eliminatórias e campeonatos.
Este primeiro MVP deve ser simples, mas a arquitetura precisa ser criada corretamente para permitir que, no futuro, o YouTube seja substituído por um provedor de conteúdo de karaokê licenciado/pago sem necessidade de reconstruir o sistema.
1. PRINCÍPIO FUNDAMENTAL DO PROJETO
O Karaoke Arena NÃO deve ser construído como um "aplicativo de vídeos do YouTube".
O YouTube será apenas o primeiro provedor de playback utilizado durante o MVP/teste.
A arquitetura deve separar:
Karaoke Arena
    ↓
Playback Provider
    ↓
YouTube

No futuro:
Karaoke Arena
    ↓
Playback Provider
    ↓
Provedor de Karaokê Licenciado

Portanto, NÃO espalhar chamadas, IDs ou lógica específica do YouTube por toda a aplicação.
Criar uma camada/abstração de provider.
Conceitualmente:
PlaybackProvider

com uma implementação inicial:
YouTubePlaybackProvider

No futuro poderemos ter:
LicensedKaraokeProvider

ou outros providers.
2. MOBILE FIRST — REQUISITO FUNDAMENTAL
A aplicação deve ser construída desde o início seguindo Mobile First.
O principal dispositivo do operador provavelmente será um:
celular;
tablet.
Não assumir que haverá um computador disponível no bar, restaurante ou evento.
O operador deve conseguir executar o fluxo completo pelo celular:
Abrir aplicação
↓
Iniciar sessão
↓
Cadastrar cantor
↓
Pesquisar música
↓
Escolher playback
↓
Iniciar apresentação
↓
Encerrar apresentação
↓
Cadastrar próximo cantor

Tudo isso deve funcionar confortavelmente em uma tela de smartphone.
3. USO EM TV
A aplicação também deverá funcionar diretamente em uma TV/Smart TV através do navegador da TV quando o navegador for compatível.
Porém, separar conceitualmente:
Interface do operador
Mobile First.
Interface pública
TV/desktop/projector First.
Criar uma rota específica:
/tv

Essa tela não deve possuir menus administrativos.
Ela serve exclusivamente para exibir:
cantor atual;
música;
player;
estado da apresentação;
futuramente votação;
futuramente resultado;
futuramente ranking.
4. RESPONSIVIDADE
A aplicação inteira deve ser responsiva.
Prioridade:
celular;
tablet;
desktop;
TV/telas grandes.
Não criar simplesmente uma versão desktop que "encolhe" no celular.
Projetar os componentes começando pela menor tela.
Usar:
layouts fluidos;
botões grandes;
áreas de toque confortáveis;
tipografia adaptativa;
grids responsivos;
containers responsivos;
player responsivo;
navegação adequada para celular.
Testar especialmente larguras próximas de:
360px
375px
390px
412px
768px
1024px
1280px+

5. EXPERIÊNCIA DO OPERADOR
O operador deve conseguir trabalhar sozinho com o celular.
Tela inicial:
🎤 KARAOKE ARENA

O público decide quem continua.

[ INICIAR NOVA SESSÃO ]

Se houver sessão ativa:
[ CONTINUAR SESSÃO ]

6. SESSÕES
Criar entidade:
sessions

Campos:
id
name
status
started_at
ended_at
created_at
updated_at

Status:
draft
active
finished

Uma sessão representa um evento de karaokê.
Exemplo:
Karaoke Arena
Sábado à noite

Status:
ATIVA

7. CANTORES
Criar entidade real:
participants

Campos:
id
session_id
name
stage_name
participant_number
created_at
updated_at

name é obrigatório.
stage_name é opcional.
participant_number é gerado automaticamente dentro da sessão.
Exemplo:
Cantor 1
João Silva
João

Cantor 2
Maria Souza
Maria

Cantor 3
Carlos Santos

Na tela podemos mostrar:
Cantor 1
JOÃO

Se não houver nome artístico:
Cantor 1
JOÃO SILVA

A arquitetura deve permitir futuramente adicionar:
foto;
perfil;
histórico;
ranking;
pontuação;
participações em campeonatos.
Não implementar essas funcionalidades agora.
8. FLUXO PRINCIPAL DO MVP
O fluxo deve ser:
INICIAR SESSÃO
       ↓
CADASTRAR CANTOR
       ↓
PESQUISAR MÚSICA
       ↓
SELECIONAR PLAYBACK
       ↓
CONFIRMAR
       ↓
CRIAR PERFORMANCE
       ↓
INICIAR APRESENTAÇÃO
       ↓
CANTOR CANTA
       ↓
VÍDEO TERMINA OU OPERADOR ENCERRA
       ↓
FINALIZAR PERFORMANCE
       ↓
PRÓXIMO CANTOR

9. PLAYBACK PROVIDER
Criar uma abstração para reprodução.
Conceitualmente:
PlaybackProvider

Responsabilidades:
pesquisar conteúdo;
retornar resultados;
carregar conteúdo;
reproduzir;
pausar;
detectar término;
informar erros.
Criar inicialmente:
YouTubePlaybackProvider

Não criar ainda outro provider real.
A arquitetura, porém, deve permitir adicionar posteriormente:
LicensedKaraokeProvider

sem alterar a entidade performance.
10. MODELO DE PLAYBACK
Criar uma entidade ou estrutura conceitual de playback_sources.
Exemplo:
id
provider
external_id
title
channel_name
thumbnail_url
duration
metadata
created_at

Exemplo atual:
provider:
youtube

external_id:
abc123XYZ

No futuro:
provider:
licensed_karaoke

external_id:
KARAOKE-847392

O restante do sistema não deve precisar saber como o conteúdo é fornecido.
11. PERFORMANCE
Criar entidade:
performances

Campos:
id
session_id
participant_id
playback_source_id
status
started_at
ended_at
created_at
updated_at

Status:
queued
active
completed
cancelled

Uma performance representa uma apresentação de um cantor.
Exemplo:
João
↓
Performance #001
↓
Evidências
↓
YouTube

O vídeo/provedor NÃO deve ficar diretamente acoplado ao participante.
12. YOUTUBE — APENAS COMO PROVIDER INICIAL
Durante o MVP, utilizar o YouTube como fonte de playback.
Utilizar exclusivamente mecanismos oficiais:
YouTube Data API;
YouTube IFrame Player API;
YouTube Embedded Player.
Referências oficiais:
https://developers.google.com/youtube/v3/docs/search/list
https://developers.google.com/youtube/iframe_api_reference
https://developers.google.com/youtube/terms/developer-policies
https://developers.google.com/youtube/terms/required-minimum-functionality
13. CONFORMIDADE COM YOUTUBE
A implementação deve respeitar as políticas atuais do YouTube.
NÃO:
baixar vídeos;
baixar áudio;
extrair áudio;
converter para MP3;
armazenar cópias do conteúdo audiovisual;
usar proxy para o conteúdo;
criar player próprio para substituir o player YouTube;
remover branding;
ocultar atribuição;
remover controles obrigatórios;
bloquear anúncios do YouTube;
colocar elementos sobre o player;
mascarar que o conteúdo é fornecido pelo YouTube;
criar iframe aninhado para contornar políticas;
alterar o conteúdo audiovisual;
separar áudio e vídeo.
O player deverá ser o player oficial incorporado.
A aplicação deve agregar valor independente por meio de:
gerenciamento da sessão;
cadastro de cantores;
organização das apresentações;
votação;
competição;
ranking;
integração futura com ESP32.
Isso é fundamental.
14. YOUTUBE SEARCH
Criar uma Edge Function:
youtube-search

Responsabilidade:
receber a busca;
consultar a YouTube Data API;
pesquisar somente vídeos;
priorizar vídeos incorporáveis;
retornar dados mínimos necessários;
não expor a API key.
Utilizar, quando apropriado:
type=video
videoEmbeddable=true

15. ECONOMIA DE QUOTA
Este requisito é IMPORTANTE.
Estou usando YouTube inicialmente apenas para testar a viabilidade do produto e quero evitar desperdício de quota.
A implementação NÃO deve fazer uma chamada à YouTube API a cada tecla digitada.
NÃO fazer:
e
ev
evi
evid
evide
eviden
...

Cada uma como chamada à API.
Em vez disso:
[ Pesquisar "Evidências" ]

fazer uma única pesquisa.
Pode utilizar debounce, mas prefiro uma ação explícita de pesquisa para o primeiro MVP.
Não implementar paginação automática.
Buscar inicialmente uma quantidade pequena de resultados, por exemplo 5 a 10.
Não buscar 50 resultados sem necessidade.
Não executar chamadas adicionais até que o operador solicite.
Não fazer polling da YouTube API.
16. RESULTADOS DE PESQUISA
Mostrar:
thumbnail;
título;
canal;
duração quando disponível;
botão "Selecionar".
Exemplo:
┌───────────────────────────────┐
│ thumbnail                     │
│                               │
│ Evidências - Karaoke          │
│ Canal: XXXXX                  │
│                               │
│ [ SELECIONAR ]                │
└───────────────────────────────┘

Não reproduzir automaticamente os resultados.
O operador escolhe.
17. CACHE DE PESQUISA — COM CUIDADO
Para reduzir chamadas repetidas durante o desenvolvimento, pode existir cache temporário dos RESULTADOS DE METADADOS da pesquisa.
Porém:
NÃO armazenar cópias de vídeos, áudio ou conteúdo audiovisual do YouTube.
NÃO implementar download.
NÃO transformar o cache em catálogo próprio de vídeos.
Se houver dúvida sobre o que pode ser armazenado segundo as políticas do YouTube, optar pela solução mais conservadora.
18. API KEY
A API key deve ficar somente no backend/Edge Function.
Utilizar secret/environment variable.
Nunca:
colocar no React;
colocar em código público;
colocar no Git;
colocar em localStorage;
enviar desnecessariamente ao navegador.
Criar tratamento para:
secret ausente;
chave inválida;
quota excedida;
erro de rede;
nenhum resultado.
19. PLAYER
Após selecionar um resultado:
YouTube video ID
        ↓
YouTube IFrame Player
        ↓
Tela de apresentação

Utilizar a IFrame Player API.
O player deve ser responsivo.
No celular:
largura: 100%
aspect-ratio: 16 / 9

No desktop:
player maior.
Na TV:
player grande e centralizado.
Respeitar o tamanho mínimo exigido pelo YouTube.
A documentação atual recomenda 16:9 com pelo menos 480×270 quando houver controles.
20. NUNCA COLOCAR OVERLAY SOBRE O PLAYER
Todos os elementos do Karaoke Arena devem ficar fora da área do iframe.
NÃO colocar:
botões sobre o vídeo;
contadores sobre o vídeo;
logos sobre o vídeo;
banners sobre o vídeo;
textos sobre os controles;
elementos transparentes interceptando toque.
O player deve continuar sendo plenamente utilizável pelo usuário.
As políticas atuais do YouTube proíbem overlays que obscureçam partes do player ou seus controles.
21. TELA DE APRESENTAÇÃO
Criar uma tela responsiva:
KARAOKE ARENA

Cantor 1
JOÃO

Evidências

┌──────────────────────┐
│                      │
│  YOUTUBE PLAYER      │
│                      │
└──────────────────────┘

Apresentação em andamento

[ ENCERRAR ]

No celular, organizar verticalmente.
Na TV, usar uma composição horizontal/centralizada apropriada para tela grande.
Não sacrificar a funcionalidade do player para obter efeitos visuais.
22. AUTOPLAY
Por padrão, não depender de autoplay.
Preferir:
Selecionar música
↓
Confirmar
↓
Tela da apresentação
↓
[ INICIAR PLAYBACK ]
↓
YouTube reproduz

Se posteriormente for utilizado autoplay, implementar somente dentro das regras atuais do YouTube e dos navegadores.
Não iniciar reprodução escondida ou em background.
23. PLAYER EVENTS
Preparar o provider para lidar com:
onReady
onStateChange
onError

Estados:
unstarted
playing
paused
buffering
ended
error

Quando o vídeo terminar:
performance.status = completed

Registrar ended_at.
24. TELA DE TV
Criar:
/tv

Essa tela deverá ser independente da interface administrativa.
Não mostrar:
menus;
dashboard;
configurações;
cadastro;
botões de administração.
Ela deve mostrar somente a experiência pública.
Exemplo:
KARAOKE ARENA

🎤 JOÃO

EVIDÊNCIAS

[ YOUTUBE PLAYER ]

APRESENTAÇÃO EM ANDAMENTO

Futuramente:
👍 32
👎 8

e:
82,5% DE APROVAÇÃO

25. CONTROLE PELO CELULAR + EXIBIÇÃO NA TV
A arquitetura deve permitir que:
CELULAR DO OPERADOR
          │
          ▼
       SUPABASE
          │
          ▼
       TV /tv

O operador não precisa controlar a TV diretamente.
Exemplo:
No celular:
João
Evidências

[ INICIAR APRESENTAÇÃO ]

A TV automaticamente passa a mostrar:
JOÃO
EVIDÊNCIAS
[PLAYER]

Preparar isso usando Supabase Realtime quando apropriado.
Não fazer polling contínuo da página.
26. VOTAÇÃO FUTURA
Criar tabela:
votes

Campos:
id
performance_id
controller_id
vote_type
created_at

Tipos:
like
dislike

Criar:
controllers

Campos:
id
device_code
status
last_seen
firmware_version
created_at
updated_at

Mas NÃO implementar o firmware ESP32 nesta fase.
A próxima fase adicionará:
ESP32 Super Mini
      ↓
Wi-Fi
      ↓
API/Supabase
      ↓
Vote
      ↓
Realtime
      ↓
TV

27. REGRA FUTURA DE VOTO
A arquitetura deve permitir:
1 controle
=
1 voto
por performance

No futuro o mesmo controle poderá alterar seu voto:
LIKE
↓
DISLIKE

ou o sistema poderá bloquear nova alteração.
Não decidir isso agora.
Somente preparar a estrutura.
28. FUTURO PROVEDOR DE KARAOKÊ PAGO
Este é um requisito arquitetural obrigatório.
Não criar youtube_video_id diretamente como única referência dentro de performances.
Usar:
playback_sources

Exemplo:
playback_sources

id
provider
external_id
title
channel_name
thumbnail_url
duration
metadata
created_at

Hoje:
provider = youtube
external_id = XXXXX

No futuro:
provider = licensed_karaoke
external_id = XXXXX

A performance deverá apontar para:
playback_source_id

e não diretamente para o YouTube.
29. FUTURO CATÁLOGO
Não criar ainda um catálogo próprio de músicas.
Porém deixar o conceito preparado:
Music Catalog
      ↓
Playback Provider

No futuro poderemos ter:
Pesquisar música
      ↓
Catálogo licenciado
      ↓
Selecionar
      ↓
Playback

O operador não deverá precisar saber qual tecnologia está por trás do playback.
30. IMPORTANTE SOBRE LICENCIAMENTO
O uso do YouTube como provider técnico do MVP não significa automaticamente que um estabelecimento esteja autorizado a executar publicamente qualquer música.
Não implementar nenhum mecanismo para burlar direitos autorais.
Não afirmar que o YouTube fornece automaticamente licença de execução pública.
A futura versão comercial deverá ter uma análise específica de:
direitos autorais;
execução pública;
licenciamento musical;
termos do fornecedor de conteúdo.
Manter essa questão separada da arquitetura técnica.
31. MOBILE NAVIGATION
Como o operador trabalhará principalmente pelo celular:
Usar uma navegação simples e apropriada para mobile.
Evitar menus desktop complexos.
A tela principal deverá priorizar:
Sessão atual
Cantor atual
Próximo passo

Exemplo:
KARAOKE ARENA

● Sessão ativa

🎤 Cantor atual
JOÃO

🎵 Música
EVIDÊNCIAS

[ CONTINUAR APRESENTAÇÃO ]

────────────────

Próximo
MARIA

32. CADASTRO DE CANTOR
Modal ou tela mobile:
NOVO CANTOR

Nome
[________________]

Nome artístico
[________________]

[ CANCELAR ]

[ CADASTRAR ]

Depois:
✓ Cantor cadastrado

Cantor 1
JOÃO

33. FILA
Mostrar:
ORDEM

1. João
2. Maria
3. Carlos
4. Ana

Neste MVP não implementar drag-and-drop.
Apenas exibir.
34. DASHBOARD MOBILE
Criar um dashboard simples.
Exemplo:
KARAOKE ARENA

Sexta-feira

🟢 Sessão ativa

CANTOR ATUAL
João

MÚSICA
Evidências

[ ABRIR APRESENTAÇÃO ]

────────────────

PRÓXIMOS

Maria
Carlos
Ana

35. DESIGN
Visual moderno e relacionado a música/competição.
Não copiar identidade visual do The Voice ou de qualquer outra marca.
Utilizar:
tipografia forte;
cards;
microanimações;
boa hierarquia;
alto contraste;
botões grandes;
feedback visual;
aparência premium.
Mas:
Mobile First.
Não criar uma interface desktop e depois simplesmente reduzir.
36. ACESSIBILIDADE
Considerar:
áreas de toque grandes;
contraste adequado;
labels;
foco;
navegação por teclado no desktop;
textos legíveis à distância na TV;
mensagens de erro claras.
37. SUPABASE
Criar as tabelas:
sessions
participants
playback_sources
performances
controllers
votes

Relacionamentos:
sessions
   │
   ├── participants
   │       │
   │       └── performances
   │                 │
   │                 └── playback_sources
   │
   └── ...

votes:
performance
     ↓
votes
     ↓
controller

Usar UUID.
Foreign keys.
Índices apropriados.
Timestamps.
RLS.
38. SEGURANÇA
Não colocar service role key no frontend.
Criar RLS adequada.
A interface pública da TV deve receber somente os dados necessários.
A interface administrativa deve possuir acesso apropriado.
Se autenticação ainda não for necessária para o primeiro protótipo, estruturar a arquitetura para adicioná-la posteriormente sem refazer as tabelas.
39. PERFORMANCE
A aplicação deverá ser rápida em celular.
Evitar:
bundles desnecessariamente grandes;
bibliotecas pesadas;
chamadas repetitivas;
polling;
renderizações desnecessárias;
imagens gigantes;
buscas automáticas na API.
Carregar o player somente quando necessário.
Não carregar múltiplos players do YouTube simultaneamente.
Na tela pública, manter apenas a apresentação atual.
40. OFFLINE / FALHAS
Não precisamos implementar modo offline completo.
Mas tratar elegantemente:
Internet indisponível

YouTube indisponível

Supabase indisponível

YouTube API quota excedida

Mostrar mensagens compreensíveis.
Nunca deixar a aplicação simplesmente travada em loading infinito.
41. NÃO IMPLEMENTAR AGORA
Não implementar:
ESP32 firmware;
Bluetooth;
ESP-NOW;
ranking avançado;
campeonato;
duelo X1;
eliminatórias;
gamificação;
IA;
análise vocal;
afinação;
reconhecimento de cantor;
pagamentos;
assinaturas;
catálogo licenciado;
Spotify;
download de músicas;
armazenamento de áudio;
catálogo próprio de vídeos;
sistema multi-tenant completo.
A arquitetura deve permitir essas evoluções posteriormente.
42. CRITÉRIO DE CONCLUSÃO
O MVP só estará concluído quando este teste funcionar:
Teste 1
Abrir pelo celular.
Teste 2
Criar sessão.
Teste 3
Cadastrar:
João Silva

Teste 4
O sistema gerar:
Cantor 1

Teste 5
Pesquisar:
Evidências

Teste 6
Receber resultados reais da YouTube Data API.
Teste 7
Selecionar um resultado incorporável.
Teste 8
Criar playback_source:
provider = youtube
external_id = ...

Teste 9
Criar performance.
Teste 10
Abrir a tela:
/tv

Teste 11
A TV mostrar:
JOÃO
EVIDÊNCIAS

e o player oficial do YouTube.
Teste 12
O operador controlar a apresentação pelo celular.
Teste 13
Encerrar a apresentação.
Teste 14
O Supabase registrar:
performance.status = completed

Teste 15
Cadastrar Maria.
Teste 16
Confirmar:
Cantor 1 → João
Cantor 2 → Maria

Teste 17
Repetir a apresentação com Maria.
Teste 18
Confirmar que a apresentação da Maria não altera a apresentação do João.
Teste 19
Abrir o sistema em celular, tablet e desktop.
Teste 20
Verificar a tela pública em uma viewport grande.
43. TESTE DE QUOTA
Durante o desenvolvimento, verificar:
quantas chamadas search.list são realizadas;
se uma busca gera somente uma chamada;
se digitar no campo não gera chamadas;
se resultados não são buscados repetidamente sem necessidade;
se a aplicação evita chamadas quando a busca está vazia;
se o erro de quota é tratado.
Adicionar, no ambiente administrativo de desenvolvimento, uma pequena informação:
YouTube API
Última pesquisa: ...

e, se possível sem violar políticas, uma indicação interna da quantidade de chamadas realizadas pela aplicação.
Não expor informações técnicas desnecessárias para o usuário final.
44. ARQUITETURA FINAL ESPERADA
A estrutura conceitual deverá ser:
                KARAOKE ARENA
                       │
          ┌────────────┴────────────┐
          │                         │
      OPERADOR                    TV
      MOBILE                  /tv
          │                         │
          └────────────┬────────────┘
                       │
                   SUPABASE
                       │
       ┌───────────────┼────────────────┐
       │               │                │
    SESSIONS       PERFORMANCES       VOTES
       │               │                │
 PARTICIPANTS     PLAYBACK_SOURCE   CONTROLLERS
                       │
                PLAYBACK PROVIDER
                       │
                ┌──────┴──────┐
                │             │
             YOUTUBE       FUTURO
              MVP       LICENCIADO

Essa separação é importante.
Não construir o sistema inteiro em torno do YouTube.
45. REGRAS FINAIS DE DESENVOLVIMENTO
Antes de alterar qualquer arquivo:
analisar o projeto;
analisar a estrutura existente;
verificar dependências;
verificar configuração do Supabase;
verificar se existem componentes reutilizáveis.
Não apagar funcionalidades existentes.
Não duplicar componentes.
Não criar arquivos desnecessários.
Não instalar bibliotecas sem necessidade.
Não usar dados fake quando a funcionalidade puder ser real.
Não esconder erros.
Não criar workaround para políticas do YouTube.
Não baixar ou armazenar conteúdo do YouTube.
Não criar um player alternativo.
Não fazer chamadas desnecessárias à API.
Não sacrificar a experiência mobile em favor do desktop.
Ao final, executar build e testes.
Informar:
arquivos criados;
arquivos alterados;
tabelas;
RLS;
Edge Functions;
secrets necessários;
configuração Google/YouTube necessária;
quantidade de chamadas à API realizadas durante os testes;
como testar pelo celular;
como abrir a tela da TV;
limitações encontradas;
arquitetura preparada para futuro provider de karaokê licenciado;
partes que ficaram preparadas para a ESP32.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://batalhaoke.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/43aa7e95-fd37-4ae9-8ba5-9f47ae9be11d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
