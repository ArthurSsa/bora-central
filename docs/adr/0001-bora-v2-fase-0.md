# ADR 0001 — Bora v2: a arquitetura da Fase 0

- **Estado:** aprovado pelo Arthur em 27/10/2026 (as decisões da seção 7 seguem em aberto, uma a uma)
- **Data:** 27/10/2026
- **Escopo:** o que fica, o que entra e o que sai na reestruturação do produto ("sistema operacional de criação"), e o que a Fase 0 (28/10 a 06/11) precisa medir antes de qualquer tela nova

## 1. Contexto: o que existe hoje, medido

| O quê | Estado em 27/10 |
|---|---|
| Banco `bora-postar` (`yxewmauwnxnrrhevlbtc`) | 47 tabelas; 3 contas, 9 clientes, 22 pedidos, 25 jobs; 31 migrações neste repositório |
| Fábrica (`worker/`) | 11 skills; 7 apps da ArtCraft ligados (PhotoCraft, EffectCraft, LightCraft, FilmCraft, SoundCraft, VectorCraft, DesignCraft); modo Claude e modo roteiro; 76 testes de unidade e 23 de ponta a ponta |
| Custo medido com o Claude (Opus 5.5) | post US$ 0,14 a 0,19; ajuste em texto livre US$ 0,13; guia US$ 0,11; abertura animada US$ 0,28; edição no Studio US$ 0 (sem modelo). Média dos 6 jobs com custo: US$ 0,167 |
| Front | `sites/app` (100 KB) e `sites/central` (555 KB), HTML único sem build; `sites/formulario` |
| Vercel | `bora-app`, `bora-central`, `bora_conhecer`, `bora-estudio` (pausado, ainda ligado ao GitHub) |
| Já entregue que o v2 aproveita | Studio de camadas (etapa F, `camadas.ts`, `edicao.ts`) e a pessoa no post (etapa H, `pessoa.ts`: rosto, recorte guiado, conferência do rosto) |

## 2. Premissas do prompt que não batem com o que está no banco e no código

Conferido antes de escrever. Cada uma muda uma decisão abaixo.

1. **`planos` já é outra coisa.** É o plano do mês de conteúdo (`cliente_id, mes, diagnostico, plano, pauta`), usado pela pauta e pelo "Criar isso". As colunas de cobrança (cota de gerações, preço) não podem entrar ali. Decisão D8 cria `planos_assinatura`.
2. **`jobs.tipo` não existe.** O job tem `rodada` (producao, ajuste, da_bora, edicao…) e `skill`, e `pedido_id` é obrigatório com chave estrangeira. Decisão D11.
3. **O banco é compartilhado com o produto original.** Há `brand_profiles`, `carousels`, `reel_*`, `credits_ledger` (100 linhas), `subscriptions` e `processed_stripe_events` (Stripe, vazios). Nada disso é deste repositório e nada disso é tocado: o v2 não reaproveita a camada Stripe, porque a cobrança escolhida é Asaas.
4. **`sites/estudio` já saiu** (etapa B). O projeto `bora-estudio` no Vercel está pausado mas continua ligado ao GitHub, e por isso todo pull request mostra um check vermelho. Tirar o projeto é uma mudança no Vercel: só com ok.
5. **Transcrição:** hoje é o `whisper.cpp` dentro do worker. O FilmCraft 0.13 tem `sequence.transcribe`, trilha de legenda com estilo (`captions.setStyle`) e exportação com legenda queimada ou SRT ao lado. A troca é um teste da Fase 2, não uma premissa.
6. **Máscara por IA no LightCraft existe** (`mask.add` com `subject`, `object` e `prompt`), mas precisa do modelo SAM 3, que não está na máquina. Hoje o recorte da pessoa é do PhotoCraft (`select.object` guiado pelo rosto). O SAM entra só se o teste da Fase 0 mostrar que recorta melhor, e o download pede ok antes.
7. **AniCraft:** o repositório estava vazio na etapa E. Fica o encaixe em `apps.ts`, sem uso.
8. **Fonte da marca:** para o navegador e a fábrica desenharem o mesmo texto, a fonte tem que existir nos dois. Hoje a fábrica instala fontes de `fontes.json`. Decisão D2.

## 3. Decisões

### D1. A cena no banco é a fonte da verdade; PSD, PNG e MP4 são exportações

No v1 a peça é um PSD que a fábrica monta e a equipe edita. No v2 a peça é uma **cena** (objetos com posição, tamanho, rotação, ordem e propriedades) guardada no banco. O Studio mexe na cena direto no navegador, na hora, sem ida à fábrica. A fábrica entra para **gerar** (a cena inicial, imagens, clipes) e para **exportar** (cena → PSD com camadas nomeadas → PNG; cena → EffectCraft → MP4).

Consequência: a rodada `edicao` da etapa F (que aplica a edição no PSD) deixa de ser o caminho principal. Ela continua servindo os pedidos antigos até a migração de dezembro.

### D2. Prévia e exportação têm que sair iguais, e isso se mede

O risco técnico número um é o texto: o navegador (Konva) e o PhotoCraft quebram linha e medem fonte de jeitos diferentes. Se a prévia mostra três linhas e o PNG sai com quatro, o produto perde a confiança.

- **Uma especificação da cena só** (`cena.v1`, JSON versionado), lida pelo navegador e pela fábrica.
- **Fontes só do catálogo do Google Fonts**, carregadas no navegador pela mesma família e peso que a fábrica instala (`fontes.json` cresce por marca).
- **Quebra de linha decidida num lugar só:** a fábrica mede o texto e devolve as linhas; o navegador desenha essas linhas. Ao editar, o navegador quebra por conta própria e a fábrica confere na exportação.
- **A conferência compara:** exportação contra prévia, pixel a pixel, com limiar. Diferença acima do limiar reprova e diz onde.
- **Spike da Fase 0:** 20 cenas de teste desenhadas nos dois lados, diferença medida. Se passar de 2% dos pixels em texto, a decisão de quem quebra linha muda antes da Fase 1.
- **Resultado (28/10, `docs/medidas/fidelidade-previa-exportacao.md`):** a quebra de linha saiu idêntica nas 20 cenas; o texto só diferia na altura, corrigida pela linha de base que a fábrica informa por fonte (diferença nos textos de 14,8% para 1,5%). O navegador quebra a linha ao editar e a fábrica confere. A régua da conferência passa a ser "mesmas linhas, deslocamento zero e até 4% de borda nos textos", e não 2% de pixels.

### D3. Objetos em tabela, gravados juntos

A tabela `objetos` como o prompt pede (uma linha por objeto, RLS por conta), mas **gravada por cena inteira** numa RPC `salvar_cena(cena_id, objetos jsonb, versao_base)`. Ela substitui os objetos da cena de uma vez, numa transação, e recusa se outra pessoa salvou no meio (concorrência otimista pelo número da versão). Arrastar não escreve no banco a cada movimento: o navegador grava ao soltar, com espera de 1 s. Desfazer e refazer moram no navegador; `versoes` guarda o retrato a cada aprovação, a cada mudança do assistente e a cada exportação.

### D4. Geração de imagem e vídeo atrás de uma interface só

`worker/src/geracao.ts` com `gerarImagem({ pedido, estilo, marca, formato, n }) → assets[]` e `gerarClipe({ pedido | imagem, segundos }) → asset`, e um adaptador por provedor. A chave do provedor mora no `.env` do worker, nunca no navegador. Toda geração:

- parte da marca (paleta, estilo padrão, o que nunca fazer);
- pede fundo liso e nenhum texto dentro da imagem (o texto é objeto do Studio);
- grava o custo em `assets.custo_usd` e soma na cota da conta;
- passa por cache: o mesmo pedido, estilo e marca devolve o que já existe, sem gerar de novo.

Teste de 30/10 entre Runware e fal.ai, com os mesmos 20 pedidos em 3 estilos (flat, foto, 3D suave). Critérios, nesta ordem: licença comercial do que é gerado; custo por imagem; fundo liso de verdade (o recorte funciona?); consistência de estilo entre as 3 variações; tempo até a primeira imagem. Precisa de conta e chave nos dois, e de um teto de teste (proposta: US$ 5 por provedor).

### D5. Imagem vira objeto pela ArtCraft

`worker/src/objeto.ts`:

- **Recorte de fundo:** o alfa do provedor, quando vier; senão o PhotoCraft (`layer.removeBackground`, que funciona bem em fundo liso, e o recorte guiado da etapa H para pessoa); o SAM do LightCraft só se o teste justificar.
- **Vetor:** estilos flat passam pelo VectorCraft (trace) e viram SVG com mapa de cores, recolorível pela paleta.
- **Medida:** a caixa real do objeto (pelo alfa, como `camadas.ts` já faz).

### D6. O app novo nasce num projeto novo do Vercel

`app/` com Vite, React 18, TypeScript, Zustand, react-konva e Supabase JS (link mágico, Realtime). Proposta: um projeto Vercel novo (`bora-v2`, root `app/`) durante o desenvolvimento. O `bora-app` e o `bora-central` continuam servindo os clientes atuais sem risco. Na migração de 21 e 22/12, o domínio do `bora-app` passa a apontar para o v2. Trocar o root do `bora-app` agora derrubaria o app que está no ar.

### D7. Quem é quem

Fica o que já existe: `contas` como inquilino, `conta_membros` com papel (dono, equipe, cliente) e `is_bora_member()` para a equipe da Bora. O cadastro self-service é uma Edge Function `criar_conta` que cria a conta, o cliente (o próprio negócio), o membro dono e a marca mínima, numa transação.

### D8. Cobrança com Asaas

Tabelas novas: `planos_assinatura` (nome, preço em centavos, gerações de imagem por mês, gerações de vídeo por mês, exportações por mês), `assinaturas` (conta, plano, id no Asaas, situação) e `cobranca_eventos` (id do evento do Asaas, para não processar duas vezes). `contas` ganha `plano_assinatura_id`, `situacao` (teste, ativa, inadimplente, cancelada), `teste_ate` e `indicado_por`. O webhook é uma Edge Function. A cota e o teto são conferidos **no banco, antes de enfileirar**, nunca no navegador.

### D9. Formatos são dados

Tabela `formatos` semeada com os presets da seção "Formatos" do prompt, cada um com a área segura e as zonas de interface da rede, em px. A conferência passa a ler a área segura do formato, e não os 5% fixos de hoje.

### D10. O motor fica

Fila `jobs`, `pegar_job` com lease, conferência, custo por job, `FABRICA_TETO_USD`, roteiro, skills, os módulos por app e os testes. Nada disso é reescrito.

### D11. O job aponta para pedido ou para projeto

`jobs` ganha `tipo` (gerar_cena, gerar_imagem, gerar_clipe, vetorizar, exportar_imagem, render_video, reel, animar; os de hoje ficam como `pedido`) e `projeto_id`. `pedido_id` deixa de ser obrigatório, com uma regra no banco de que um dos dois existe. É a única mudança que afrouxa uma restrição existente, e não apaga nada.

### D12. Os monólitos congelam

`sites/app` e `sites/central` só recebem correção a partir de 09/11. Saem depois da migração de dezembro. `sites/formulario` fica.

## 4. Esquema v2 (rascunho da migração, aditiva, a escrever na Fase 0 e aplicar só com ok)

| Tabela | Colunas principais | Acesso |
|---|---|---|
| `formatos` | nome, rede, largura, altura, proporcao, area_segura, zonas_interface, tipo, padrao | todos leem; só a Bora escreve |
| `projetos` | conta_id, cliente_id, titulo, objetivo, tipo, formato_id, largura, altura, fps, estado, publicar_em | `pode_ver_cliente` |
| `cenas` | projeto_id, ordem, duracao_ms, transicao, fundo | herda do projeto |
| `objetos` | cena_id, tipo, x, y, largura, altura, rotacao, ordem, opacidade, travado, origem, asset_id, props, animacao | herda da cena; escrita só por `salvar_cena` |
| `assets` | conta_id, cliente_id, tipo, caminho, largura, altura, duracao_ms, origem, custo_usd, pedido_ia, estilo, chave_cache | `pode_ver_cliente` |
| `versoes` | projeto_id, numero, retrato, saida_asset_id, criado_por, motivo | herda do projeto |
| `resultados` | projeto_id, rede, link, publicado_em, alcance, salvamentos, mensagens, observacao | herda do projeto |
| `planos_assinatura`, `assinaturas`, `cobranca_eventos` | ver D8 | dono da conta lê; webhook escreve |
| `contas` (+) | plano_assinatura_id, situacao, teste_ate, indicado_por | como hoje |
| `jobs` (+) | tipo, projeto_id; pedido_id opcional | como hoje |

A coluna do texto do pedido à IA se chama `pedido_ia` no banco e nunca aparece na tela.

## 5. O que a Fase 0 entrega (de 28/10 a 06/11)

1. **Custo por pedido medido** nos tipos que faltam com o Claude: carrossel de 5, capa, reel do bruto, cartaz. Tabela de custo por tipo e por app, tirada de `jobs`.
2. **Teste dos geradores** (D4): relatório com os 20 pedidos, as imagens, o custo e o tempo de cada provedor, e a escolha.
3. **Imagem → objeto** (D5): 20 imagens geradas, recortadas e, as flat, vetorizadas; tempo e taxa de recorte aceitável.
4. **Spike de fidelidade** (D2): 20 cenas, prévia contra exportação, diferença medida.
5. **Este ADR aprovado** e a migração do esquema v2 escrita (não aplicada).

Saída da Fase 0: os cinco itens prontos, ou a decisão escrita do que muda no plano.

## 6. Riscos

- **Fidelidade do texto** (D2): mitigado pelo spike antes de qualquer tela.
- **Calendário para uma pessoa de código:** se apertar, cede a Fase 3 (modelos, resultados, publicação assistida), não a cobrança nem o Studio.
- **Custo de vídeo gerado:** clipe por IA é a geração mais cara. O preço real sai do teste de 30/10, e a cota de vídeo por plano sai dele.
- **A fábrica ainda é um PC:** o v2 gera mais trabalho por cliente. O VPS (com os apps da ArtCraft em Linux, pelos `.deb`) precisa estar de pé antes da Fase 2.
- **Banco compartilhado com o produto original:** toda migração v2 é aditiva e nunca toca as tabelas dele.

## 7. Decisões que são do Arthur

1. **Projeto Vercel novo para o v2** (D6) ou trocar o root do `bora-app` agora.
2. **Contas e chaves no Runware e no fal.ai** para o teste de 30/10, e o teto de teste (proposta: US$ 5 cada).
3. **Baixar o modelo SAM 3 do LightCraft** para comparar o recorte (o tamanho é informado antes do download).
4. **Tirar o projeto `bora-estudio` do Vercel** (acaba o check vermelho nos pull requests).
5. **Os preços dos três planos** (Autônomo, Acompanhado, Feito para você): sem eles não dá pra medir o critério "custo abaixo de 10% do que a conta paga".
6. **`objetos` em tabela com gravação por cena** (D3), em vez de JSON dentro da cena.
