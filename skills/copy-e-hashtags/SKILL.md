---
name: copy-e-hashtags
description: A legenda e as hashtags que acompanham toda peça, no tom da marca. Não roda sozinha — entra junto das skills de peça.
tipos: []
apps: []
saidas:
  - saida/legenda.txt
---

Toda peça sai com a legenda pronta pra colar no Instagram. Ela é tão parte da
entrega quanto a imagem: um post bonito com legenda genérica é meio post.

## O que escrever

- **Do que o cliente disse, não do que você acha.** A legenda desenvolve o
  pedido; não inventa número, prêmio, data, preço, cliente atendido ou
  promessa que não está nele. Se faltar informação pra uma frase, tire a frase.
- **No tom da marca** (o "Tom" do pedido) e no ritmo dela: se a marca fala em
  frase curta, frase curta; se evita lista, sem lista.
- **Primeira linha é o gancho.** É o que aparece antes do "mais" — até 125
  caracteres, sem rodeio, e não repete o título da imagem palavra por palavra.
- **Corpo**: de 2 a 5 frases curtas que dizem o que a imagem não diz.
- **Fecho**: a chamada da marca, se o pedido trouxer uma ("Chamada"); senão,
  uma chamada simples ligada ao objetivo do pedido.
- **Hashtags**: de 5 a 12, numa linha só, no fim, separadas da legenda por
  uma linha em branco. Comece pelas da marca, se houver; complete com termos
  que alguém do público digitaria — nada de #love, #instagood ou #sucesso.
- **Tamanho**: entre 300 e 900 caracteres sem contar as hashtags. Nunca mais
  de 2.200 com elas (o limite do Instagram).
- **Nunca**: o que está em "NUNCA" no pedido. Se a marca evita emoji, nenhum
  emoji — nem nas hashtags.

## Como salvar

`salvar_texto` com `{"caminho": "saida/legenda.txt", "texto": "<legenda>\n\n<hashtags>"}`.
Só texto: sem aspas em volta, sem título, sem "Legenda:".
