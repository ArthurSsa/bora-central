---
name: post-feed
description: Post único para o feed do Instagram, 1080×1350 — fundo da marca, título na fonte da marca, faixa de destaque, assinatura e, se houver, o logo.
tipos: [post-feed]
apps: [photocraft]
usa: [copy-e-hashtags]
saidas:
  - saida/post.png 1080x1350
  - editavel/post.psd 1080x1350
  - saida/legenda.txt
---

Um post que se lê em um segundo, de longe, na tela pequena: uma ideia, dita
grande. O que não couber no título vai pra legenda, não pra imagem.

## Medidas

- Peça: 1080×1350 (retrato 4:5 do feed).
- Margem `m`: 96 px quando a marca pede margem folgada, 72 nos outros casos.
  Nenhum texto a menos de `m` da borda — a conferência reprova a 54 px.
- Pesos: use exatamente os do pedido ("Peso do título", "Peso do texto"), e
  sempre ponha o peso — sem ele o título sai no regular, sem força. Os pesos
  do pedido são os que a fonte tem de verdade: pedir 700 a uma fonte que só
  tem 400 não dá erro, mas também não engrossa.

## Passos

1. `avisar_etapa` com "desenhando o post", progresso 15.
2. `doc_new` com `{"width": 1080, "height": 1350, "background": "<fundo>", "name": "post"}`.
   Se o pedido diz "Mais sério", use o conjunto mais sóbrio da lista (o que o
   "quando" liga a posicionamento ou autoridade); senão, o conjunto indicado.
3. Faixa de destaque, embaixo, alinhada à margem:
   - `command_run` `select.rect` `{"x": m, "y": 1350 - m - 120, "width": 140, "height": 14}`
   - `command_run` `layer.newFillLayer.solidColor` `{"color": "<faixa>"}`
   - `command_run` `select.deselect` `{}`
4. `avisar_etapa` com "escrevendo o título", progresso 35. O título: no máximo
   oito palavras, tirado do que o cliente escreveu, sem inventar.
   - `command_run` `type.create` `{"text": "<título>", "box": [m, 300, 1080 - 2m, 600], "font": "<fonte>", "size": 92, "weight": <peso do título>, "color": "<texto>", "align": "<left | center>"}`
   - Fonte de impacto (condensada, tipo Anton): `size` 116 e o título em caixa alta.
5. Se o pedido tiver uma segunda informação que importa (prazo, local, data),
   ela vira uma linha de apoio logo abaixo do título — `doc_inspect` pra ler os
   `bounds` do título e então
   `type.create` `{"text": "<apoio>", "box": [m, <fim do título + 40>, 1080 - 2m, 220], "font": "<fonte>", "size": 40, "weight": <peso do texto>, "color": "<texto>"}`.
   No máximo 14 palavras. Sem apoio é melhor que apoio fraco.
6. Assinatura: `type.create` `{"text": "<@instagram>", "x": m, "y": 1350 - m, "font": "<fonte>", "size": 30, "weight": <peso do texto>, "color": "<texto>"}`.
   Se houver registro profissional, ele vai na mesma linha depois de " · ".
7. Logo: se houver um elemento `logo` na lista de elementos, coloque no canto
   de baixo à direita, com 140 px de largura:
   `doc_place` `{"path": "<caminho>", "scale": <14000 / largura do logo>, "center": [1080 - m - 70, 1350 - m - 30]}`.
   Sem logo na lista, não ponha nada no lugar.
8. Confira. `avisar_etapa` com "conferindo o post", progresso 70.
   - `doc_inspect`: título com até 4 linhas; nada passando da margem.
   - `render_preview` `{"max_side": 1024}` e olhe a imagem como o cliente vai ver.
   - Título longo demais: `type.setStyle` `{"layer": <id>, "size": 76}` (depois 64).
9. Salve: `doc_save` `{"path": "editavel/post.psd"}` e `doc_save` `{"path": "saida/post.png"}`.
10. `avisar_etapa` com "escrevendo a legenda", progresso 85, e faça a legenda
    como diz a parte "copy-e-hashtags".

## Quando o pedido é um ajuste

`doc_open` em `entrada/anterior/post.psd`, `doc_inspect` pra achar as camadas e mude
só o que foi pedido:
- "mais curto": título com no máximo quatro palavras (`type.edit` `{"layer": <id>, "text": "<novo>"}`).
- "outra cor da marca": o próximo conjunto da lista — fundo com `layer.select`
  + `edit.fill` `{"contents": "color", "color": "<fundo>"}`; faixa com
  `layer.fill.solidColor.set` `{"layer": <id>, "color": "<faixa>"}`; textos com
  `type.setStyle` `{"layer": <id>, "color": "<texto>"}`.
- "mais sério": o conjunto sóbrio e um título sem exclamação.
- "troca a foto": só se houver outra foto na lista de elementos; senão, diga no resumo.
- Texto livre: faça o que pede, dentro da marca.

Os ajustes anteriores continuam valendo. Salve as mesmas saídas e refaça a
legenda só se o ajuste mudou o assunto.
