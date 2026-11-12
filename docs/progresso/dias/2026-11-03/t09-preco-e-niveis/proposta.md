# Preço e níveis: proposta (tarefa 9)

Proposta de 03/11/2026, feita a partir do custo medido. **Nada mudou no código**; preço e plano são decisão do Arthur. Esta proposta só sugere.

## As regras usadas

- **IA até 10% do preço** (critério 4 do produto), contando o que a fábrica gasta com o Claude **e** a geração de imagem e de vídeo do v2.
- **Margem de contribuição acima de 70%:** o preço menos a IA, o imposto (6%, Anexo III, com pró-labore; ver o checklist da tarefa 10) e a taxa do Asaas (até ~3,5%). O custo fixo entra no ADR 0002, por número de contas.
- **Os custos:**
  - Claude, medido em 03/11 (`docs/medidas/custo-por-pedido.md`): post US$ 0,17, carrossel 0,28, reel 0,41, capa 0,19, cartaz 0,10, ajuste em texto livre 0,21. Cada peça leva um ajuste.
  - Geração (`docs/medidas/geradores-precos.md`, preço publicado, ainda não testado): imagem US$ 0,03 (Seedream 4.0), clipe de 5 s US$ 0,35 (Kling 2.5 Turbo Pro).
  - Câmbio: R$ 5,4212 (PTAX de 30/10).

## Os três níveis

| | Autônomo | Acompanhado | Feito para você |
|---|---|---|---|
| **Preço sugerido** | **R$ 297/mês** | **R$ 697/mês** | **R$ 1.490/mês** |
| Quem faz | o cliente, sozinho no app | o cliente no app, com revisão da equipe uma vez por semana | a equipe da Bora faz e o cliente aprova |
| Peças por mês | 10: 8 posts, 2 carrosséis | 20: 12 posts, 4 carrosséis, 2 reels, 2 capas | 40: 20 posts, 8 carrosséis, 8 reels, 4 capas |
| Reel do vídeo gravado | não | 2 | 8 |
| Imagens geradas por IA | 30 | 60 | 120 |
| Clipes gerados por IA (5 s) | não | 2 | 8 |
| Ajuste em texto livre | 1 por peça | 1 por peça | à vontade (a equipe ajusta) |
| **IA do mês (Claude + geração)** | **R$ 27** (9,1%) | **R$ 60** (8,6%) | **R$ 134** (9,0%) |
| Imposto + Asaas (~9,5%) | R$ 28 | R$ 66 | R$ 142 |
| **Margem de contribuição** | **R$ 242 (81%)** | **R$ 571 (82%)** | **R$ 1.214 (81%)** |

Contas da IA do mês (US$ → R$ a 5,4212). A geração conta **3 imagens por peça e 1 clipe por reel**:
- **Autônomo:** Claude US$ 4,07 (o mês leve) + 30 imagens × 0,03 = US$ 4,97 → R$ 27.
- **Acompanhado:** Claude 12 × 0,17 + 4 × 0,28 + 2 × 0,41 + 2 × 0,19 + 20 ajustes × 0,214 = US$ 8,64; geração 60 × 0,03 + 2 × 0,35 = US$ 2,50; total US$ 11,14 → R$ 60.
- **Feito para você:** Claude US$ 18,26 (o mês pesado) + 120 × 0,03 + 8 × 0,35 = US$ 24,66 → R$ 134. A conta põe 1 ajuste com o Claude por peça; os outros ajustes a equipe faz no Studio, sem modelo.

**A conta não inclui o tempo da equipe da Bora.** No Acompanhado é uma revisão por semana; no Feito para você, a equipe faz tudo. É por isso que o salto de preço entre os níveis é maior que o salto de custo de IA.

## Os pisos pela regra dos 10% (sem margem pra mais nada)

| Nível | Só Claude (`custo-por-pedido.md`) | Claude + geração |
|---|---|---|
| Autônomo (mês leve) | R$ 221 | R$ 270 |
| Acompanhado (mês típico, com 4 reels) | R$ 554 | R$ 742 |
| Feito para você (mês pesado) | R$ 990 | R$ 1.337 |

O Acompanhado proposto tem **2 reels e não 4**, e nem o cartaz do mês típico: assim ele fica em 20 peças e cabe nos R$ 697. Com 4 reels (22 peças), a IA vai pra R$ 72 (10,3%) e o piso pra R$ 720. Se quiserem 4 reels no Acompanhado, ou o preço sobe pra pelo menos R$ 720, ou o reel precisa cair pra perto da meta de US$ 0,30 (a próxima alavanca está no documento de custos).

## O que ainda falta definir

- **Teste grátis de 14 dias** (o prompt da reestruturação): proposta de 3 projetos, cada um com até 5 imagens geradas e sem clipe. O custo de IA de um teste fica em ~R$ 9: 15 imagens (US$ 0,45) e 3 peças com ajuste (US$ 1,15).
- **Preço do projeto de vídeo** (fora da assinatura, citado na tarefa 9): falta o custo de um vídeo de 15 s com 3 cenas e clipes. Ele sai da Fase 2.
- **Cota e teto no banco:** os números de cada nível vão pra `planos_assinatura` (ADR 0003), mas só depois da decisão.
- **Validar os preços na conversa com cliente:** com o Moacyr (rascunhos em `docs/progresso/rascunhos/2026-11-03/`) e com a Proppozzy (tarefa de 19/11).
