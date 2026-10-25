---
name: capa-thumbnail
description: Capa de vídeo do YouTube, 1280×720 — três opções de título sobre o degradê da marca, e duas sugestões de título pro vídeo.
tipos: [capa]
apps: [photocraft]
usa: [copy-e-hashtags]
saidas:
  - saida/capa-1.png 1280x720
  - saida/capa-2.png 1280x720
  - saida/capa-3.png 1280x720
  - editavel/capa-1.psd 1280x720
  - editavel/capa-2.psd 1280x720
  - editavel/capa-3.psd 1280x720
  - saida/titulos.txt
  - saida/legenda.txt
---

Capa é lida em miniatura, do lado de outros dez vídeos: três ou quatro
palavras, enormes, com contraste. As três opções existem pro cliente escolher
o ângulo — não são três tamanhos do mesmo título.

## Os três títulos

Antes de desenhar, escreva três títulos de no máximo seis palavras, cada um
por um caminho diferente, todos tirados do que o cliente disse:

1. **O resultado**: o que quem assistir ganha.
2. **A pergunta**: a dúvida que o vídeo responde.
3. **O contraste**: o "não é X, é Y" do assunto, se ele tiver um; senão, o número ou o prazo.

## Medidas

1280×720, margem `m` de 64 px. A metade esquerda é do texto; a direita é do
degradê (e da foto, se houver).

## Cada capa (1, 2 e 3)

`avisar_etapa` com "desenhando a capa N de 3", progresso 15, 35 e 55.

1. `doc_new` `{"width": 1280, "height": 720, "background": "<fundo>", "name": "capa-N"}`.
2. O degradê, só na metade direita:
   - `command_run` `select.rect` `{"x": 640, "y": 0, "width": 640, "height": 720}`
   - `command_run` `layer.newFillLayer.gradient` `{"from": "<fundo>", "to": "<destaque>", "angle": 0}`
   - `command_run` `select.deselect` `{}`
3. Se houver um elemento `foto` (de preferência um recorte, PNG com fundo
   transparente), ele entra à direita: `doc_place` `{"path": "<caminho>", "center": [960, 400], "fit": true}`.
4. O título: `type.create` `{"text": "<título N>", "box": [m, 150, 600, 420], "font": "<fonte>", "size": 84, "weight": <peso do título>, "color": "<texto>"}`.
   Fonte de impacto: 100 e caixa alta.
5. Uma faixa sob o título: `select.rect` `{"x": m, "y": 720 - m - 14, "width": 120, "height": 14}`,
   `layer.newFillLayer.solidColor` `{"color": "<faixa>"}`, `select.deselect` `{}`.
6. `render_preview` `{"max_side": 640}` — veja do tamanho que o YouTube mostra.
   Título passando de três linhas: `type.setStyle` com `size` menor.
7. `doc_save` `{"path": "editavel/capa-N.psd"}`, `doc_save` `{"path": "saida/capa-N.png"}`, `doc_close` `{}`.

## Títulos pro vídeo

`avisar_etapa` com "escrevendo os títulos", progresso 80. Duas sugestões de
título pro próprio vídeo (não pra capa), de até 70 caracteres, com o termo que
alguém buscaria no começo. Uma por linha:
`salvar_texto` `{"caminho": "saida/titulos.txt", "texto": "<título 1>\n<título 2>"}`.

Depois, a descrição do vídeo como diz a parte "copy-e-hashtags" (no YouTube,
de 3 a 5 hashtags bastam).
