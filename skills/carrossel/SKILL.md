---
name: carrossel
description: Carrossel para o feed, 1080×1350 por imagem — capa, uma ideia por slide e um slide final com a chamada.
tipos: [carrossel]
apps: [photocraft]
usa: [copy-e-hashtags]
quantidade: slides de 3 a 10, padrão 5
saidas:
  - saida/slide-{n}.png 1080x1350
  - editavel/slide-{n}.psd 1080x1350
  - saida/legenda.txt
---

Um carrossel é uma conversa em passos: a capa promete, cada slide entrega uma
coisa, o último diz o que fazer agora. Quem desliza até o fim é quem mais
importa — o último slide não pode ser despedida.

## O roteiro, antes de desenhar

Escreva primeiro o texto de todos os slides, só com o que o cliente disse:

- **Slide 01 (capa)**: a promessa, em até oito palavras.
- **Slides 02 até o penúltimo**: uma ideia por slide — um título de até seis
  palavras e, se precisar, um texto de até 30 palavras. Se o pedido não tem
  ideias pra todos os slides, não encha: escreva o que tem e diga no resumo
  que o cliente pediu mais slides do que o assunto rende.
- **Último slide**: a chamada da marca ("Chamada" no pedido) ou, sem ela, uma
  ação ligada ao objetivo. E o @ do perfil.

A quantidade de slides é a da lista "Entregue".

## Medidas

As mesmas do post-feed: 1080×1350, margem `m` de 96 (folgada) ou 72, pesos
exatos do pedido, nunca sem peso. Todos os slides no mesmo conjunto de cor.

## Cada slide

Um documento por slide: `doc_new` `{"width": 1080, "height": 1350, "background": "<fundo>", "name": "slide-NN"}`,
os elementos, `doc_save` `{"path": "editavel/slide-NN.psd"}`, `doc_save` `{"path": "saida/slide-NN.png"}`
e `doc_close` `{}` antes do próximo. Antes de cada um, `avisar_etapa` com
"desenhando o slide N de T" e progresso entre 10 e 80, subindo.

- **Capa (01)**: título `type.create` `{"text": "<promessa>", "box": [m, 340, 1080 - 2m, 620], "font": "<fonte>", "size": 96, "weight": <peso do título>, "color": "<texto>"}`;
  faixa como no post-feed (`select.rect` `{"x": m, "y": 1350 - m - 120, "width": 140, "height": 14}`,
  `layer.newFillLayer.solidColor` `{"color": "<faixa>"}`, `select.deselect` `{}`);
  e embaixo `type.create` `{"text": "Arrasta pro lado →", "x": m, "y": 1350 - m, "font": "<fonte>", "size": 30, "weight": <peso do texto>, "color": "<texto>"}`.
- **Do meio**: o número do slide em destaque, `type.create` `{"text": "02", "x": m, "y": m + 110, "font": "<fonte>", "size": 120, "weight": <peso do título>, "color": "<destaque>"}`;
  o título `type.create` `{"text": "<título>", "box": [m, 380, 1080 - 2m, 300], "font": "<fonte>", "size": 64, "weight": <peso do título>, "color": "<texto>"}`;
  o texto, se houver, `type.create` `{"text": "<texto>", "box": [m, 720, 1080 - 2m, 420], "font": "<fonte>", "size": 38, "weight": <peso do texto>, "color": "<texto>"}`.
  O destaque precisa passar no contraste com o fundo; se não passar (a
  conferência mede), use a cor do texto no número.
- **Último**: a chamada `type.create` `{"text": "<chamada>", "box": [m, 420, 1080 - 2m, 480], "font": "<fonte>", "size": 72, "weight": <peso do título>, "color": "<texto>"}`,
  a faixa como na capa e o @ `type.create` `{"text": "<@instagram>", "x": m, "y": 1350 - m, "font": "<fonte>", "size": 34, "weight": <peso do texto>, "color": "<texto>"}`.
- **Numeração** (quando a marca numera), em todos menos a capa: `type.create`
  `{"text": "N/T", "box": [1080 - m - 160, 1350 - m - 40, 160, 50], "font": "<fonte>", "size": 28, "weight": <peso do texto>, "color": "<texto>", "align": "right"}`.
  Embaixo, e não em cima: em cima o Instagram põe o próprio contador.

Fonte de impacto (condensada): títulos em caixa alta e 20% maiores.

Confira cada slide com `render_preview` antes de salvar: título com até
quatro linhas, texto sem passar da margem. Grande demais: `type.setStyle` com
`size` menor.

Depois de todos: `avisar_etapa` com "escrevendo a legenda", progresso 85, e a
legenda como diz a parte "copy-e-hashtags" — ela fala do carrossel inteiro.

## Quando o pedido é um ajuste

A versão anterior está em `entrada/anterior/slide-NN.psd`. Abra só os slides
que o ajuste afeta ("outra cor da marca" afeta todos; "mais curto" afeta os
títulos), mude o que foi pedido e salve as mesmas saídas — inclusive dos
slides que não mudaram, abrindo e salvando de novo.
