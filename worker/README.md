# Fábrica — o worker do Estúdio

Consome a fila `jobs` do Supabase, roda o agente (Claude pelo Agent SDK) com os
apps da ArtCraft que a skill pedir, confere o que saiu e sobe pro balde
`pedidos`. O cliente nunca vê nada disto: vê a etapa em português e a peça pronta.

```
pedido (cliente) ──► jobs (na_fila) ──► pegar_job() ──► pasta do job
                                                         │
                         skills/<nome>/SKILL.md ──► agente ──► photocraft-cli mcp (raízes = pasta do job)
                                                         │
                                       conferência (existe? formato? tamanho?)
                                                         │
                         balde pedidos/<conta>/<cliente>/<pedido>/<job>/{saida,editavel}/
                                                         │
                                    jobs (pronto) · pedido (para_aprovar) · custos
```

Sem build: Node 22.18+ roda os `.ts` direto.

## Rodar aqui

```bash
cd worker
npm install
npm run fontes            # as fontes das marcas (fontes.json), onde o PhotoCraft procura
cp .env.exemplo .env      # preencha SUPABASE_SERVICE_ROLE_KEY e ANTHROPIC_API_KEY
npm test                  # sem rede e sem modelo; os testes do PhotoCraft pulam se ele não estiver instalado
npm run ensaio            # monta o agente com chave inválida: confere MCP e ferramentas, custo zero
npm start                 # escuta a fila
npm run enfileirar-teste  # em outro terminal: põe um post da Glau na fila e acompanha até o fim
```

Sem chave da Anthropic, `npm run roteiro` sobe o worker trocando o Claude por
um passo a passo fixo (`src/roteiro.ts`) que segue a skill de teste. A fila, o
PhotoCraft, a conferência, o Storage e o Realtime são os de verdade; só quem
decide é que não é o modelo. Custo zero. Serve também, depois, para separar
"a máquina quebrou" de "o agente errou".

`npm run e2e` é o teste do app do cliente (`sites/app/`) de ponta a ponta: um
cliente de teste, numa conta só dele, pede um post num celular de 390 px,
acompanha, pede ajuste, vê a versão nova e aprova — contra o banco de verdade,
a fábrica no modo roteiro e o PhotoCraft. Confere também isolamento, contraste
nos dois temas e rolagem lateral. Usa o Edge ou o Chrome da máquina
(`playwright-core`, sem baixar navegador). `E2E_FOTOS=<pasta>` guarda as telas.

No Windows o PhotoCraft portátil fica em `worker/.ferramentas/photocraft/` (fora
do git) e o worker acha o `.exe` sozinho. No Linux, os `.deb` instalam em `/usr/bin`.

## A fábrica neste PC

Enquanto não há VPS, a fábrica roda no PC da Bora. Ela só **busca** pedidos no
Supabase: nenhuma porta aberta, nada de fora entra no computador.

```bash
npm run fabrica:instalar   # atalho na inicialização do Windows, e já liga
npm run fabrica:estado     # ligada? desde quando? fazendo o quê?
npm run fabrica:desligar   # termina o pedido atual e desliga
npm run fabrica:ligar      # liga de novo, sem janela
npm run fabrica:remover    # desliga e tira da inicialização
```

- **Liga sozinha** quando alguém entra no Windows (atalho em `shell:startup`
  que abre o vigia escondido) — não antes: sem login, ela espera.
- **Volta sozinha:** o vigia religa o worker se ele cair (5 s, dobrando até
  1 min se cair logo de novo), e o que ficou pela metade volta pra fila na
  hora, com a tentativa contada.
- **Não trava o PC:** vigia, worker e os apps que ele abre rodam com
  prioridade "abaixo do normal".
- **Tudo em `%LOCALAPPDATA%\BoraFabrica`:** `logs\fabrica.log` (gira em 5 MB,
  guarda 3), `jobs\` (pasta de cada pedido; a que deu certo sai na hora, a que
  falhou fica 7 dias) e o pid do vigia.
- **Sem a chave da Anthropic**, roda no roteiro. Com ela no `.env`, usa o Claude.
- **A Fábrica da Central** mostra se ela está ligada (sinal a cada 30 s,
  contado pelo relógio do banco).
- **O PC não pode dormir:** Configurações → Sistema → Energia → Suspender:
  Nunca (na tomada). A tela pode apagar.

Antes do `npm run e2e`, desligue a fábrica do PC: os dois workers disputariam
os pedidos do teste (o teste recusa começar com ela ligada).

## Skills

| Skill | Tipo no app | Entrega |
|---|---|---|
| `post-feed` | Post para feed | post 1080×1350 + legenda |
| `carrossel` | Carrossel | 3 a 10 slides 1080×1350 + legenda |
| `capa-thumbnail` | Capa ou thumbnail | 3 capas 1280×720 + 2 títulos pro vídeo + descrição |
| `copy-e-hashtags` | — (entra nas outras) | as regras da legenda |
| `post-feed-teste` | — (só pelo nome) | o post mínimo do passo 1 |

Cada skill tem um roteiro em `src/roteiro.ts` com os mesmos comandos do
SKILL.md. Se o roteiro passa na conferência de marca, a receita da skill é boa
— é o que os testes provam sem gastar token.

## A conferência de marca

Depois do agente (ou do roteiro), `src/conferencia.ts` mede cada imagem
contra a marca do cliente: fonte e peso de cada texto (lidos do PSD), cor de
tudo que ocupa espaço (lida do PNG, com o degradê entre duas cores da marca
aceito), texto fora da faixa de 5% da borda e contraste do texto sobre o que
está atrás dele. E os textos: limite do Instagram, hashtags, emoji quando a
marca evita, os dois títulos da capa. Reprovou, o job volta pra fila com o
motivo, e a próxima tentativa recebe esse motivo no pedido.

## Fontes

`fontes.json` lista as fontes das marcas (Manrope, Anton), de um commit fixo
do google/fonts e com sha256. `npm run fontes` baixa, confere e copia pra pasta
de fontes do usuário (Windows) ou `~/.local/share/fonts` (Linux) — não mexe nas
fontes do sistema. Marca nova com fonte nova: uma linha a mais no arquivo.

## O que garante o isolamento

- O agente não tem ferramenta embutida nenhuma (`tools: []`): sem shell, sem
  ler arquivo, sem web. Só fala com os servidores MCP dos apps e com `fabrica`.
- PhotoCraft e EffectCraft sobem com `--automation-read-root` e
  `--automation-write-root` na pasta do job; fora dela é recusado (há teste).
- FilmCraft e LightCraft não têm raiz: recebem só caminhos dentro da pasta do
  job. No VPS, o worker roda com um usuário de sistema próprio.
- O worker entra no banco com service_role, mas toda escrita filtra pelo job e
  pelo worker que o segura.

## Custos

Cada job grava tokens (entrada, saída, cache) e `custo_usd` vindos do SDK, e
`render_segundos` somando o tempo de cada chamada aos apps. Tentativa que falhou
também soma. `FABRICA_TETO_USD` corta a rodada que passar do teto.

## Apps e flags

| App | Subida | Observação |
|---|---|---|
| PhotoCraft | `mcp --automation-read-root J --automation-write-root J` | testado aqui |
| EffectCraft | `mcp --autosave` + as mesmas raízes | pelos docs; entra no passo 6 |
| LightCraft | `mcp --library J/biblioteca J/frames` | sem raiz; passo 6 |
| FilmCraft | `mcp --project J/editavel/projeto.fcproj --data-dir J/.filmcraft` | recusa raízes; passo 5 |
| SoundCraft | só o CLI: `script`, `convert` | o som dos vídeos (`src/som.ts`); etapa C |
| VectorCraft | `mcp --headless` + as raízes; o roteiro usa `run` | logo vetorial e cartaz (`src/vetor.ts`); etapa D |

O SoundCraft (0.13.1, portátil, em `.ferramentas/soundcraft/`) faz o som dos
vídeos sem janela: trata a voz do reel (filtro de graves, de-esser,
compressor), põe a trilha da marca por baixo — abaixando onde há legenda,
pela automação de volume — e acerta -16 LUFS com o pico até -1 dB. A trilha é
música com licença que a equipe sobe na Marca (`marca_trilhas`, balde
`trilhas`); nada gera música. A sessão sobe como `editavel/som.zip`, que abre
no SoundCraft de qualquer PC. Os testes usam a música de demonstração do
próprio SoundCraft, que ele sintetiza.

O VectorCraft (0.17.0, portátil, em `.ferramentas/vectorcraft/`) faz duas
coisas. O logo que a equipe sobe em vetor (SVG, PDF, AI, EPS) vira PNG de
1200 px nas cores dele e numa versão de uma cor pra cada tinta dos conjuntos
— quando uma cor do logo some no fundo, a peça usa a de uma cor. E o cartaz
para imprimir (A4 ou A3): PDF com 3 mm de sangria, TrimBox, BleedBox e marcas
de corte, PNG pro WhatsApp, editável em `.vectorcraft` e `.ai`. A conferência
lê as caixas do PDF, a margem de 15 mm dos textos e as cores da imagem.

`transcript.generate` (FilmCraft) e `develop.sync` (LightCraft), citados no
prompt original, não aparecem na documentação atual dos repositórios — o mais
próximo no LightCraft é `develop.autoSync`. Conferir com `commands` no próprio
CLI antes de escrever as skills dos passos 5 e 6.
