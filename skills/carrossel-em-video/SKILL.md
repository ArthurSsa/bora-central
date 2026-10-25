---
name: carrossel-em-video
description: Um carrossel já aprovado vira reel em pé — cada imagem entra da direita, fica 2,5 s chegando perto e dá lugar à próxima, sobre o fundo da marca; prévia de 3 s antes do completo.
tipos: [reel]
formato: carrossel
apps: [effectcraft]
usa: [copy-e-hashtags]
entrada: slides
saidas:
  - saida/previa.mp4
  - saida/reel.mp4 1080x1920
  - saida/legenda.txt
  - editavel/carrossel.ecproj
---

O cliente aprovou um carrossel e quer o mesmo conteúdo no Reels, que alcança
quem não segue a conta. As imagens não mudam — foram elas que ele viu e
aprovou. O que entra de novo é o movimento e o fundo, na cor da marca.

O que já está pronto quando você começa: as imagens aprovadas, na ordem, em
`entrada/slides/slide-01.png`, `slide-02.png`…

## Passos

1. `avisar_etapa` "montando a cena", 10. `cena_da_marca` `{}` monta
   `editavel/carrossel.ecproj` com todas as imagens: cada uma entra da
   direita em meio segundo, fica 2,5 s chegando um pouco mais perto, e sai
   pra esquerda quando a próxima entra. A última fica até o fim.
   Não reordene, não corte e não pinte por cima das imagens.

2. `avisar_etapa` "preparando a prévia", 20, e `renderizar_motion`
   `{"previa": true}`.

3. `renderizar_motion` `{"previa": false}`.

4. `avisar_etapa` "escrevendo a legenda", 90, e a legenda do post como diz a
   parte "copy-e-hashtags", sobre o assunto do carrossel.

Sem som: ainda não há trilha com licença.
