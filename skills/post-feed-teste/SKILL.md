---
name: post-feed-teste
description: Post de teste da fábrica — fundo da marca, título na fonte da marca, faixa de destaque. Serve pra provar o caminho de ponta a ponta, não pra ir ao ar.
# Sem tipo: só roda quando o job pede esta skill pelo nome. Os pedidos de
# "post-feed" vão pra skill post-feed desde o passo 3.
tipos: []
apps: [photocraft]
saidas:
  - saida/post.png 1080x1350
  - editavel/post.psd 1080x1350
---

Uma peça só, 1080×1350 (retrato 4:5 do feed), com três elementos: o fundo
na cor do conjunto, o título e uma faixa curta de destaque embaixo. Nada além
disso — esta skill existe pra provar que o caminho funciona, e cada elemento a
mais é uma coisa a mais pra dar errado no teste.

## Passos

1. `avisar_etapa` com "desenhando o post", progresso 20.

2. `doc_new` com `{"width": 1080, "height": 1350, "background": "<fundo do conjunto>", "name": "post"}`.

3. A faixa de destaque, embaixo à esquerda, alinhada com a margem do texto:
   - `command_run` `select.rect` com `{"x": <margem>, "y": 1180, "width": 180, "height": 16}`
   - `command_run` `layer.newFillLayer.solidColor` com `{"color": "<faixa do conjunto>"}`
   - `command_run` `select.deselect` com `{}`

   A margem é 96 px quando a marca pede margem folgada, 72 px nos outros casos.

4. O título. Tire do pedido uma frase de no máximo oito palavras que diga o
   assunto; se o cliente escreveu mais que isso, resuma sem inventar nada que
   ele não disse. `avisar_etapa` com "escrevendo o título", progresso 45.
   - `command_run` `type.create` com
     `{"text": "<título>", "box": [<margem>, 420, <1080 - 2 × margem>, 600], "font": "<fonte indicada>", "size": 88, "weight": 700, "color": "<texto do conjunto>", "align": "<left | center>"}`
   - Alinhamento: `left` quando a marca alinha à esquerda, `center` quando centraliza.
   - O `box` é texto de parágrafo: o PhotoCraft quebra a linha sozinho dentro da largura.

5. Confira. `avisar_etapa` com "conferindo o post", progresso 70.
   - `doc_inspect`: a camada de texto tem que estar com a fonte pedida e os
     `bounds` têm que caber dentro de `[margem, margem, 1080 - margem, 1350 - margem]`.
   - `render_preview` com `{"max_side": 1024}` e olhe a imagem.
   - Se o título passar de quatro linhas ou encostar na faixa, diminua com
     `type.setStyle` (`{"size": 72}`, depois 60) e confira de novo.

6. Salve, nesta ordem:
   - `doc_save` com `{"path": "editavel/post.psd"}` — o editável, com as camadas separadas.
   - `doc_save` com `{"path": "saida/post.png"}` — o que o cliente vê.

## Quando o pedido é um ajuste

Se o pedido tem a seção "Ajuste pedido", não comece do zero: a peça já foi
feita e o cliente quer mudar uma coisa.

1. `avisar_etapa` com "fazendo o ajuste", progresso 20.
2. `doc_open` com `{"path": "entrada/anterior/post.psd"}` e `doc_inspect` pra achar
   as camadas (o fundo, a faixa e o texto).
3. Mude só o que foi pedido:
   - "mais curto": reescreva o título com no máximo quatro palavras, sem
     perder o assunto, com `type.edit` na camada de texto.
   - "outra cor da marca": troque pro próximo conjunto da lista "Outros
     conjuntos da marca" — fundo com `layer.select` (`{"layer": <id do fundo>}`)
     e depois `edit.fill` (`{"contents": "color", "color": "<fundo>"}`); faixa
     com `layer.fill.solidColor.set` (`{"layer": <id da faixa>, "color": "<faixa>"}`);
     texto com `type.setStyle` (`{"layer": <id do texto>, "color": "<texto>"}`).
   - "mais sério": o conjunto mais sóbrio da marca (o que o "quando" associa a
     posicionamento ou autoridade) e um título sem exclamação.
   - "troca a foto": esta peça não tem foto; diga isso no resumo e não mude nada.
   - Texto livre: faça o que ele pede, dentro das regras da marca. Se pedir
     algo que a marca proíbe, não faça e diga no resumo.
4. Os ajustes anteriores continuam valendo: não desfaça nenhum.
5. Confira e salve igual aos passos 5 e 6 acima.
