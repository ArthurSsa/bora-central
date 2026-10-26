---
name: guia-pdf
description: Guia em PDF, A5, de 6 a 12 páginas — capa, uma ideia do cliente por página e a página final com o contato. Pra baixar e mandar no WhatsApp, ou trocar por contato. Feito no DesignCraft, na marca.
tipos: [material]
formato: guia
apps: [designcraft]
quantidade: paginas de 6 a 12, padrão 8
saidas:
  - saida/guia.pdf
  - saida/pagina-{n}.png 1080x1532
  - editavel/guia.designcraft
  - editavel/guia.idml
---

O cliente quer um material curto que a pessoa guarda: um guia, um passo a
passo, uma lista de erros comuns. É lido no celular, uma página por vez.

O que importa, nesta ordem:
1. **Uma ideia por página.** Cada página do miolo leva uma ideia do pedido,
   inteira, grande. O cliente escreveu as ideias: não invente outras, não
   junte duas numa página, não acrescente número, dado ou promessa.
2. **A marca.** O fundo do conjunto, o texto na tinta, o número na cor de
   destaque, a fonte da marca, o logo na capa e no fim.
3. **Fechar.** A última página chama pro contato (a chamada da marca) e diz
   quem é (o @ e o registro).

A capa leva o título (o tema, em até oito palavras) e, se houver, uma linha de
apoio. O miolo tem `paginas` − 2 páginas: é quantas ideias o pedido precisa.

## Passos

1. `avisar_etapa` "diagramando o guia", 20. `material_da_marca`
   `{"titulo": "...", "ideias": ["...", "..."]}` monta tudo no DesignCraft e
   salva o PDF, uma prévia por página e os editáveis (`.designcraft` e
   `.idml`, que abre no InDesign). Mande as ideias do pedido, na ordem, uma
   por item; ajuste só o que for preciso pra caber (sem mudar o sentido).

2. Se faltar ideia ou o texto não couber nem no menor tamanho, a ferramenta
   avisa: corrija e chame de novo.

## Quando o pedido é um ajuste

"Mais curto": título em até quatro palavras. "Outra cor da marca": passe o
nome do próximo conjunto em `conjunto`. O resto, como no pedido.
