---
name: folheto-dobravel
description: Folheto dobrável em três, A4 frente e verso — capa, verso com o contato, aba e três ideias por dentro. PDF/X-4 pra gráfica (sangria de 3 mm, marcas de corte, cor em CMYK), prévia de cada lado e editável. Feito no DesignCraft, na marca.
tipos: [material]
formato: folheto
apps: [designcraft]
saidas:
  - saida/folheto.pdf
  - saida/pagina-01.png 1684x1191
  - saida/pagina-02.png 1684x1191
  - editavel/folheto.designcraft
  - editavel/folheto.idml
---

O folheto é o que fica no balcão e vai na sacola: a pessoa pega, abre e lê
de dentro pra fora. Três painéis por lado, dobrados em três.

O que importa, nesta ordem:
1. **A capa vende a abertura.** O título, grande, no painel da direita do
   lado de fora. O verso (o do meio) tem a chamada pro contato, o @ e o logo.
2. **Por dentro, uma ideia por painel.** As três primeiras ideias do pedido;
   a quarta em diante vão na aba (o painel que aparece primeiro ao abrir). O
   cliente escreveu as ideias: não invente outras.
3. **A gráfica.** O fundo passa 3 mm do corte, o texto fica 10 mm pra dentro
   de cada painel, a cor vai em CMYK. Se uma cor da marca não sai igual no
   CMYK, a fábrica avisa — quem decide é a equipe.

## Passos

1. `avisar_etapa` "diagramando o folheto", 20. `material_da_marca`
   `{"titulo": "...", "apoio": "...", "ideias": ["...", "...", "..."]}` monta
   o folheto no DesignCraft e salva o PDF de gráfica, a prévia de cada lado e
   os editáveis (`.designcraft` e `.idml`).

2. Se faltar ideia ou o texto não couber, a ferramenta avisa: corrija e chame
   de novo.

## Quando o pedido é um ajuste

"Mais curto": título em até quatro palavras. "Outra cor da marca": passe o
nome do próximo conjunto em `conjunto`.
