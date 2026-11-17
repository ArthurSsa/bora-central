# ADR 0003 — Arquitetura do Bora v2

- **Estado:** proposto, esperando o ok do Arthur
- **Data:** 03/11/2026
- **Tarefa:** #11 "Arquitetura do sistema novo (ADR)", pronto quando "ADR escrito; esquema v2 desenhado"
- **Parte de:** ADR 0001 (Fase 0). Este ADR fecha o que ficou aberto lá e **substitui a decisão D6** (o projeto Vercel novo).

## 1. O que fica

O motor construído entre 25 e 27/10 continua por baixo do v2, sem reescrita:

| Peça | Onde | Por que fica |
|---|---|---|
| Banco, autenticação e arquivos | Supabase `bora-postar` | contas, membros e RLS por cliente já isolam inquilinos; Realtime já mostra o andamento |
| A fábrica | `worker/` | fila `jobs` com lease, `pegar_job`, tentativas, teto por rodada, roteiro sem modelo, os 7 apps da ArtCraft |
| As skills | `skills/` | uma por tipo de peça; o agente lê, o cliente não vê |
| A conferência | `worker/src/conferencia.ts` | fonte, peso, cor, margem, contraste, rosto, legenda e som, medidos no arquivo entregue |
| O custo por job | `jobs.custo_usd`, `render_segundos`, `npm run custos` | é a base do preço e da cota por plano |
| Os módulos por app | `som.ts`, `vetor.ts`, `diagramacao.ts`, `motion.ts`, `reel.ts`, `video.ts`, `pessoa.ts`, `camadas.ts`, `edicao.ts`, `cena.ts` | cada um já resolve a parte mecânica de um app |

## 2. O que é refeito

- **Tudo que o usuário toca.** `sites/app` (100 KB) e `sites/central` (555 KB), HTML único sem build, dão lugar a um app só em `app/`, com Vite, React 18 e TypeScript. Os papéis (cliente, equipe da conta, equipe da Bora) ficam dentro dele.
- **O que é uma peça.** No v1, o pedido era um texto que virava peça pronta e fechada. No v2 é **projeto → cenas → objetos**: a fábrica gera o ponto de partida e o cliente mexe em tudo.
- **O Studio.** O da etapa F editava camadas do PSD e mandava cada edição pra fábrica. No v2 o Studio edita a cena no navegador, na hora, e a fábrica só exporta (ADR 0001, D1).

## 3. Onde o v2 mora: no projeto atual

Decisão do Arthur em 03/11: **o v2 é feito dentro do projeto atual, sem projeto novo**.

- **Código:** neste repositório, em `app/`, ao lado de `sites/`, `worker/` e `skills/`. Mesmo Git, mesmas migrações, mesmo banco.
- **Deploy:** proposta de usar o projeto Vercel **`bora-estudio`**, que já existe e está pausado. Ele seria religado, com a raiz apontando pra `app/` e o build do Vite. Assim o v2 tem endereço próprio pra ser testado sem tocar no `bora-app` e no `bora-central`, que seguem servindo os clientes atuais, e acaba de quebra o check vermelho dos pull requests. Mexer no Vercel é decisão do Arthur (fica em "Precisa de vocês").
- **Alternativa,** se não quiser religar o `bora-estudio`: o v2 entra no `bora-app` só no dia da migração (21–22/12), trocando a raiz de `sites/app` pra `app/`. Até lá, ele só roda localmente e nos testes de ponta a ponta.
- **Plano do Vercel:** o Hobby não permite uso comercial. Antes do primeiro cliente pagante, o time passa pro Pro (US$ 20/mês, já previsto em `docs/progresso/arquivos/custos-bora.md`).

## 4. O canvas: Konva

O teste de fidelidade (`docs/medidas/fidelidade-previa-exportacao.md`, 28/10) foi feito com o Konva 9.3.22, e respondeu o que importava:

- **A quebra de linha** saiu idêntica à do PhotoCraft nas 20 cenas, com o mesmo arquivo de fonte.
- **A altura do texto** se acerta com uma conta: a linha de base da primeira linha, que a fábrica informa por fonte e peso. Com ela, a diferença nos textos cai de 14,8% pra 1,5%, e o que sobra é a borda das letras.

| | Konva | Fabric |
|---|---|---|
| Medido contra a exportação | sim, 20 cenas | não |
| Integração com React | `react-konva`, declarativo, mantido | imperativo; precisa de uma camada própria |
| Arrastar, girar, alças, guias | `Transformer` pronto; guias magnéticas por evento | pronto (`controls`) |
| Texto editável no lugar | um campo HTML por cima do texto, padrão documentado | `IText` nativo |
| Peso no navegador | 172 KB | ~300 KB |

**Decisão: Konva com `react-konva`.** O Fabric só ganha na edição de texto no lugar, e um campo HTML por cima do texto resolve isso (como o Studio da etapa F já faz). Trocar pelo Fabric pediria refazer a medida de fidelidade.

## 5. O esquema v2

A migração é **aditiva**: nenhuma tabela existente perde coluna e nada é apagado. Ela vai ser escrita e mostrada antes de aplicar. Pelas regras do turno da noite, não é aplicada sem o Arthur.

| Tabela | Colunas | Acesso |
|---|---|---|
| `formatos` | `id`, `nome`, `rede`, `largura`, `altura`, `proporcao`, `area_segura jsonb` (margens em px), `zonas_interface jsonb` (retângulos onde a rede põe legenda, botões, barra), `tipo` (imagem, video, impressao), `dpi`, `padrao` | todos leem; só a Bora escreve |
| `projetos` | `id`, `conta_id`, `cliente_id`, `titulo`, `objetivo` (vender, ensinar, mostrar, convidar, contar), `tipo` (post, carrossel, story, capa, video_curto, apresentacao, impressao), `formato_id`, `largura`, `altura`, `fps`, `estado` (rascunho, gerando, pronto, aprovado, agendado, publicado), `publicar_em`, `versao_atual`, `criado_por`, `criado_em`, `atualizado_em` | `pode_ver_cliente(cliente_id)` |
| `cenas` | `id`, `projeto_id`, `ordem`, `duracao_ms`, `transicao`, `fundo jsonb` (cor, gradiente, asset) | herda do projeto |
| `objetos` | `id`, `cena_id`, `tipo` (texto, imagem, vetor, clipe, forma, logo, foto_pessoa), `x`, `y`, `largura`, `altura`, `rotacao`, `ordem`, `opacidade`, `travado`, `origem` (gerado, biblioteca, upload, marca, modelo), `asset_id`, `props jsonb`, `animacao jsonb` | herda da cena; **escrita só pela RPC `salvar_cena`** |
| `assets` | `id`, `conta_id`, `cliente_id`, `tipo` (png, svg, mp4, mp3, psd, fcproj, ecproj), `caminho`, `largura`, `altura`, `duracao_ms`, `origem`, `custo_usd`, `pedido_ia` (o texto que foi pro gerador; nunca aparece na tela), `estilo`, `chave_cache` (hash de pedido, estilo, marca e formato), `criado_em` | `pode_ver_cliente(cliente_id)` |
| `versoes` | `id`, `projeto_id`, `numero`, `retrato jsonb` (cenas e objetos), `saida_asset_id`, `criado_por` (cliente, agente, equipe), `motivo`, `criado_em` | herda do projeto |
| `resultados` | `id`, `projeto_id`, `rede`, `link`, `publicado_em`, `alcance`, `salvamentos`, `mensagens`, `observacao` | herda do projeto |
| `planos_assinatura` | `id`, `nome`, `preco_centavos`, `geracoes_imagem_mes`, `geracoes_video_mes`, `exportacoes_mes`, `ativo` | todos leem os ativos |
| `assinaturas` | `conta_id`, `plano_assinatura_id`, `asaas_id`, `situacao`, `proximo_vencimento` | dono da conta lê; webhook escreve |
| `cobranca_eventos` | `id_evento_asaas` (chave), `recebido_em`, `corpo` | só o webhook |

Colunas novas em tabelas que já existem:
- **`contas`:** `plano_assinatura_id`, `situacao` (teste, ativa, inadimplente, cancelada), `teste_ate` e `indicado_por`. `planos` continua sendo o plano do mês de conteúdo.
- **`jobs`:** `tipo` (pedido, gerar_cena, gerar_imagem, gerar_clipe, vetorizar, exportar_imagem, render_video, reel, animar) e `projeto_id`. `pedido_id` passa a ser opcional, com a regra de que um dos dois existe.

**RPCs:**
- **`salvar_cena(cena_id, objetos jsonb, versao_base)`:** troca os objetos da cena numa transação e recusa se outra pessoa salvou no meio.
- **`criar_projeto(...)`:** confere a cota do plano antes de enfileirar a geração.
- **`aprovar_projeto(...)`:** grava a versão e enfileira a exportação.

A cota e o teto são conferidos no banco, nunca no navegador.

**`cena.v1` no banco:** os objetos da tabela `objetos` têm a mesma forma do `cena.v1` de `worker/src/cena.ts`, que a fábrica já exporta pelo PhotoCraft. As duas pontas leem o mesmo formato. Por ora o `cena.v1` só tem texto, forma e imagem; rotação, sombra, cantos e animação entram com o Studio v1.

## 6. Riscos e travas

- **Armazenamento:** o Supabase está com 887 MB de 1 GB (785 MB são imagens antigas do bora-postar). O v2 grava mais arquivos por peça, e cada objeto gerado é um asset. Antes da Fase 1, limpar as imagens antigas ou passar pro Pro (US$ 25/mês).
- **Safari do iPhone:** a fidelidade foi medida no Edge. Precisa da mesma medida antes de o Studio ir pro celular.
- **A fábrica ainda é o PC:** o v2 gera mais trabalho por cliente. O VPS precisa estar de pé antes da Fase 2 (vídeo).

## 7. Decisões que são do Arthur

1. Religar o projeto `bora-estudio` no Vercel pro v2 (seção 3), ou deixar o v2 só local até a migração.
2. O esquema da seção 5, antes de virar migração.
