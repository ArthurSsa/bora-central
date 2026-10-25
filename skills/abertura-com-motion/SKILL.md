---
name: abertura-com-motion
description: Abertura animada de 10 s em pé, sem vídeo gravado — o tema entra letra por letra na fonte e nas cores da marca, com barra de destaque e câmera chegando perto; prévia de 3 s antes do completo.
tipos: [reel]
formato: abertura
apps: [effectcraft]
usa: [copy-e-hashtags]
saidas:
  - saida/previa.mp4
  - saida/reel.mp4 1080x1920
  - saida/legenda.txt
  - editavel/abertura.ecproj
---

O cliente não gravou nada: quer anunciar um tema, abrir uma série, chamar pra
uma novidade. A abertura é o tema dele, curto, entrando na tela com movimento
— dez segundos que funcionam sozinhos no Reels ou na frente de outro vídeo.

O que importa, nesta ordem:
1. **Ler.** O título fica inteiro e parado do terceiro segundo até o fim. O
   Reels repete o vídeo: o último quadro é o que mais se vê.
2. **A marca.** Só a fonte e as cores da marca; o fundo é o do conjunto, o
   texto na tinta dele, a barra na cor de faixa.
3. **A área segura.** Tudo entre 10% e 75% da altura: em cima o Instagram põe
   o nome da conta, embaixo a legenda e os botões.

## Passos

1. `avisar_etapa` "montando a cena", 10. `cena_da_marca`
   `{"titulo": "...", "rotulo": "@conta ou nome"}` monta a cena base em
   `editavel/abertura.ecproj`: fundo, barra que abre, título que sobe letra
   por letra, rótulo que aparece embaixo e a câmera que se aproxima devagar.
   O título é o tema em no máximo oito palavras, do jeito que o cliente diria
   — não invente promessa, número ou data que ele não deu.

2. Se quiser mudar algo da cena base (o ritmo da entrada, uma segunda linha
   menor), abra o projeto no EffectCraft com `open_project`, mude com
   `run_script` e salve de volta no mesmo arquivo com `save_project`. Olhe o
   resultado com `render_frame` em 1 s, 3 s e 9,9 s antes de seguir.
   Sem efeito que mude a cor (brilho, glow colorido, grade): a conferência
   mede as cores do último quadro.

3. `avisar_etapa` "preparando a prévia", 20, e `renderizar_motion`
   `{"previa": true}`: os 3 primeiros segundos em meia resolução, que o
   cliente vê na hora.

4. `renderizar_motion` `{"previa": false}`: os 10 s em 1080×1920. Enquanto
   anda, a tela do cliente mostra quanto falta — medido nos quadros.

5. `avisar_etapa` "escrevendo a legenda", 90, e a legenda do post como diz a
   parte "copy-e-hashtags".

Sem som: ainda não há trilha com licença.

## Quando o pedido é um ajuste

A versão anterior está em `entrada/anterior/abertura.ecproj`. "Outra cor da
marca": `cena_da_marca` de novo com `{"conjunto": "<o próximo>"}`. "Mais
curto": título com no máximo quatro palavras. Renderize prévia e completo de
novo.
