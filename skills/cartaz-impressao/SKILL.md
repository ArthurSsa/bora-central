---
name: cartaz-impressao
description: Cartaz para imprimir, A4 ou A3 — PDF pra gráfica com 3 mm de sangria e marcas de corte, PNG pro WhatsApp, e editável em .vectorcraft e .ai. Feito no VectorCraft, no conjunto, na fonte e com o logo da marca.
tipos: [cartaz]
apps: [vectorcraft]
saidas:
  - saida/cartaz.pdf
  - saida/cartaz.png 1080x1527
  - editavel/cartaz.vectorcraft
  - editavel/cartaz.ai
---

O cliente quer um cartaz de papel: na parede da academia, no balcão, no
mural do condomínio. É lido de longe e de passagem — o título é tudo.

O que importa, nesta ordem:
1. **Ler de longe.** Um título curto e grande. O apoio (o que vem depois de
   ":" no pedido) é uma linha só, menor. Nada de parágrafo.
2. **A marca.** O fundo do conjunto, o texto na tinta dele, a barra na cor de
   destaque, a fonte da marca e o logo. Se uma cor do logo for a do fundo, use
   a versão de uma cor que está na lista de elementos.
3. **A gráfica.** O fundo passa 3 mm do corte (sangria); todo texto fica 15 mm
   pra dentro. O PDF leva as marcas de corte e as caixas que a gráfica lê.

O tamanho do papel vem no pedido (`folha`: a4 ou a3; sem ele, A4).

## Passos

1. `avisar_etapa` "montando o cartaz", 20. `cartaz_da_marca`
   `{"titulo": "...", "apoio": "..."}` monta o cartaz no VectorCraft e salva
   tudo: `saida/cartaz.pdf`, `saida/cartaz.png`, `editavel/cartaz.vectorcraft`
   e `editavel/cartaz.ai`. O título é o tema em no máximo oito palavras, do
   jeito que o cliente diria — não invente promessa, preço ou data que ele não
   deu. O apoio é a segunda informação do pedido, ou nada.

2. Se o título não couber nem no menor tamanho, a ferramenta avisa: encurte e
   chame de novo.

## Quando o pedido é um ajuste

"Mais curto": título em até quatro palavras. "Outra cor da marca": passe o
nome do próximo conjunto em `conjunto`. O resto, como no pedido.
