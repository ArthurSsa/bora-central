# Custo por pedido (Fase 0, bloco 1)

## Lote de 03/11: pré-registro (escrito antes de rodar)

- **O quê:** 18 pedidos, 3 de cada tipo que só tinha uma medida. São carrossel de 5, capa, cartaz A4, guia em PDF (6 páginas), abertura animada e post com a pessoa. Saem pela fábrica do PC com o Claude Opus 5.5 (`npm run lote`; os ids ficam em `docs/medidas/lotes/2026-11-03.json`).
- **Marcas:** um terço em cada uma, pra ver se a marca muda o custo:
  - padaria de demonstração: Manrope, 3 conjuntos, logo vetorial;
  - Moacyr: Anton, 3 conjuntos, sem logo;
  - Virtuex: sem marca nenhuma, então a fábrica deriva as cores e usa a fonte padrão.
  
  O post com a pessoa vai 3 vezes na padaria, porque é a única marca com foto no banco de fotos.
- **Textos:** os da pauta da padaria; no Moacyr e na Virtuex, textos neutros da área de cada um, pra não inventar estratégia de cliente real.
- **Teto:** US$ 0,50 por rodada, **uma tentativa por pedido**, US$ 5 no lote inteiro. São duas metades de 9; a segunda só entra se o pior caso dela couber no que sobrou.
- **O que conta como falha:** o job que termina `falhou` (reprovado na conferência, passou do teto ou o agente parou). O custo dele entra na média do tipo, porque é dinheiro gasto. O motivo vai na tabela.
- **O que não conta:** nada é refeito pra "dar certo". Uma falha é um resultado.

## Lote de 03/11: resultado

- **18 pedidos do lote + 3 ajustes em texto livre + 1 reel:** 21 de 22 prontos, **US$ 3,86** no total, dentro do teto do bloco (US$ 5 no lote) e da noite (US$ 8).
- **A única falha:** a abertura animada da Virtuex, a marca sem nada cadastrado. A conferência reprovou porque o texto saiu da área segura do Instagram aos 9,9 s. A falha é da peça, não da medida: o custo dela (US$ 0,09) entra na média.
- **Os ids de cada pedido** estão em `docs/medidas/lotes/2026-11-03.json`. Nada foi publicado; tudo está "para aprovar".

### Custo por tipo com o Claude, com as medidas de 27/10 e 03/11 somadas (`npm run custos`)

| Peça | n | Média | Mínimo | Máximo | Até ficar pronta |
|---|---|---|---|---|---|
| post | 2 | US$ 0,17 | 0,16 | 0,19 | 0,8 min |
| post com a pessoa | 4 | US$ 0,12 | 0,11 | 0,14 | 0,7 min |
| carrossel de 5 | 4 | US$ 0,28 | 0,21 | 0,33 | 1,5 min |
| capa (3 opções) | 4 | US$ 0,19 | 0,14 | 0,23 | 1,0 min |
| cartaz A4 | 4 | US$ 0,10 | 0,05 | 0,15 | 0,4 min |
| guia em PDF | 4 | US$ 0,09 | 0,06 | 0,12 | 0,4 min |
| abertura animada | 4 | US$ 0,20 | 0,09 | 0,28 | 1,1 min |
| reel do vídeo gravado | 2 | US$ 0,41 | 0,39 | 0,43 | 2,6 min |
| ajuste em texto livre (post, post com a pessoa, carrossel, capa) | 4 | US$ 0,21 | 0,13 | 0,32 | 1,0 min |

O post simples ficou com n = 2, porque não entrou no lote (já tinha 2). O reel de 0,39 é o que falhou em 27/10 antes da correção, e o de 0,43 é o de hoje.

### A marca muda o custo

Média do carrossel, da capa, do cartaz, do guia e da abertura em cada marca:

| Marca | Média |
|---|---|
| padaria: Manrope, 3 conjuntos, logo vetorial | US$ 0,21 |
| Moacyr: Anton, 3 conjuntos, sem logo | US$ 0,15 |
| Virtuex: sem marca | US$ 0,11 |

Uma marca completa custa o dobro de uma vazia, porque o agente tem mais regra pra seguir: o logo em duas versões, os conjuntos, os obrigatórios. Pro preço, vale o custo da marca completa, porque é o que o cliente pagante vai ter.

### O reel com as legendas de uma vez

A ferramenta nova (`legendas_no_video`) funcionou: o reel saiu pronto e conferido, e a saída do Claude caiu de 20 mil pra 6,4 mil tokens. O custo, porém, ficou em **US$ 0,43**, acima da meta de US$ 0,30. Agora o que pesa é a releitura do contexto: 533 mil tokens lidos de cache em 24 passos, porque o catálogo de comandos do FilmCraft vem inteiro a cada passo. A próxima alavanca é dar ao agente o FilmCraft com o catálogo enxuto (o servidor tem um modo `--compact`) e juntar os passos de corte numa ferramenta da fábrica, como foi feito com as legendas.

### Os três meses (passo 10)

Cada peça leva um ajuste em texto livre, a US$ 0,21. O câmbio é a **PTAX de 30/10/2026: R$ 5,4212** por dólar ([Banco Central, SGS série 1](https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/5?formato=json)); a de 03/11 ainda não tinha saído, e 02/11 foi feriado.

| Mês | Peças | IA em US$ | IA em R$ |
|---|---|---|---|
| leve: 8 posts, 2 carrosséis | 10 | 4,07 | 22,09 |
| típico: 12 posts, 4 carrosséis, 4 reels, 2 capas, 1 cartaz | 23 | 10,22 | 55,41 |
| pesado: 20 posts, 8 carrosséis, 8 reels, 4 capas | 40 | 18,26 | 99,01 |

### O preço mínimo por nível (passo 12): IA até 10% do preço

| Nível | Mês que ele cobre | Piso do preço |
|---|---|---|
| Autônomo | leve | **R$ 221** |
| Acompanhado | típico | **R$ 554** |
| Feito para você | pesado | **R$ 990** |

O piso de 28/10 era R$ 217 / 466 / 722. Ele subiu por três motivos:
- o ajuste ficou mais caro com n = 4 (US$ 0,21 contra 0,13);
- o reel entrou com o custo real (US$ 0,41);
- o câmbio subiu (R$ 5,42 contra R$ 5,33).

**Ainda fora desta conta:** a geração de imagem e de vídeo do v2 (uns US$ 0,09 por post com imagem gerada; uns US$ 0,70 por vídeo com 2 clipes; ver `docs/medidas/geradores-precos.md`), os impostos (6% ou 15,5% do faturamento; ver o checklist da tarefa 10) e o custo fixo.

### O que o banco não tem

O reel medido com o Claude em 27/10 (US$ 1,03, no cliente de teste) e a tentativa de US$ 0,13 antes dele **não estão mais no banco**: o teste de ponta a ponta apaga os pedidos do cliente de teste quando começa, e rodou logo depois. Os "reels com custo zero" de 27/10 que aparecem no banco são rodadas do teste, pelo roteiro, sem Claude. Por isso a análise de 28/10, feita só pelo banco, achou US$ 2,06 e não US$ 2,22. **Regra daqui em diante:** medição nunca no cliente de teste.

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
