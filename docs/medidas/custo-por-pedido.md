# Custo por pedido (Fase 0, bloco 1)

- **Medido em:** 27/10/2026, na fábrica do PC, com o Claude Opus 5.5 e teto de US$ 0,50 por rodada
- **Como refazer:** `cd worker && npm run custos` (lê `jobs` e `job_eventos`; não gasta nada)
- **Gasto deste bloco:** US$ 2,22, acima do teto de US$ 2 combinado: o reel medido depois da correção ia ter uma tentativa só, mas a fábrica pegou o pedido antes de a mudança entrar e fez duas (US$ 1,03)

## O que custa cada peça com o Claude

| Peça | Rodadas medidas | Custo médio | Até ficar pronta |
|---|---|---|---|
| post | 2 | US$ 0,17 | 0,8 min |
| post com a pessoa | 1 | US$ 0,14 | 0,7 min |
| carrossel de 5 | 1 | US$ 0,33 | 1,7 min |
| capa de vídeo (3 opções) | 1 | US$ 0,19 | 1,2 min |
| cartaz A4 | 1 | US$ 0,15 | 0,5 min |
| guia em PDF | 1 | US$ 0,11 | 0,4 min |
| abertura animada | 1 | US$ 0,28 | 1,3 min |
| ajuste em texto livre (post) | 1 | US$ 0,13 | 0,8 min |
| edição no Studio | 2 | US$ 0 (sem modelo) | 0,1 min |
| reel do vídeo gravado | 1 que deu certo | US$ 0,47 a rodada, encostado no teto | 2,7 min |

Cada número vem de uma ou duas rodadas: serve pra ordem de grandeza, não pra preço final. Entre as imagens, o carrossel é o mais caro porque o agente escreve cinco slides (6,6 mil tokens de saída contra 2,6 mil do post). O reel é o mais caro de todos: 20 mil tokens de saída, porque o agente manda um comando por corte e por legenda.

## Onde vai o tempo

O tempo dentro dos apps da ArtCraft é pequeno: somando todas as rodadas com o Claude, 7,6 s no EffectCraft (o render da abertura), 4,9 s no PhotoCraft (92 chamadas), menos de 1 s em cada um dos outros. O minuto e pouco até a peça ficar pronta é quase todo o Claude pensando e escrevendo. Pra ficar mais rápido e mais barato, o que mexe é o tamanho do que o agente escreve (texto do pedido, instruções da skill), não a máquina.

## O mês típico de um cliente

12 posts, 4 carrosséis, 4 reels, 2 capas e 1 cartaz, com um ajuste em texto livre por peça (US$ 0,13 cada):

| Peça | Quantas | Subtotal |
|---|---|---|
| post | 12 | US$ 3,69 |
| carrossel | 4 | US$ 1,86 |
| reel do vídeo gravado | 4 | US$ 2,61 |
| capa | 2 | US$ 0,64 |
| cartaz | 1 | US$ 0,28 |
| **total** | **23** | **US$ 9,08** |

O custo médio do reel nessa conta (US$ 0,52) inclui as rodadas que falharam antes da correção. Sem reel, o mês fica em US$ 6,47.

Pelo critério do produto (o custo de IA abaixo de 10% do que a conta paga), um cliente desse tamanho precisa pagar pelo menos **10 vezes isso: uns US$ 90 por mês**, ou US$ 65 sem reel. Ainda faltam nessa conta:
- a geração de imagem e de vídeo do v2, que sai do teste dos provedores;
- o assistente do Studio ("pedir ajuste" em texto livre no v2);
- o custo fixo (VPS, Supabase, Vercel), que não depende de quantos pedidos a conta faz.

## O que a medida achou

1. **O reel do vídeo gravado não funcionava com o Claude (corrigido).** Ele só tinha sido testado no roteiro. A skill mandava o agente ler a transcrição em `entrada/transcricao.json`, mas o agente da fábrica não tem como ler arquivo (é proposital: ele só fala com os apps). Ele importava o vídeo, via que não conseguia seguir e parava sem exportar: US$ 0,13 por tentativa, em 3 tentativas na padaria e 1 no cliente de teste. Agora a fábrica monta o projeto do FilmCraft (vídeo na sequência, transcrição carregada) antes do agente, e o FilmCraft dele abre nesse projeto. Com isso, o reel saiu pronto e passou na conferência.
2. **O reel encosta no teto de US$ 0,50.** A primeira rodada depois da correção passou do teto e foi cortada; a segunda terminou com US$ 0,47. O que pesa é o agente mandar um comando por corte e um por legenda. Uma ferramenta da fábrica que põe todas as legendas de uma vez (o roteiro já faz assim) deve cortar boa parte disso. É o próximo ganho de custo do reel.
3. **O erro agora diz o que o agente disse.** Quando a conferência reprova por falta de arquivo, o erro do job leva as últimas palavras do agente (até 300 letras). Foi assim que o problema do reel apareceu em um minuto, em vez de ficar escondido como "o arquivo não existe". A próxima tentativa recebe isso junto.
