---
name: reel-de-bruto
description: Reel a partir do vídeo que o cliente gravou — corta pausas, muletas e frase repetida, aproxima a câmera nos cortes, legenda na marca e entrega 1080×1920 a -16 LUFS, com prévia de 15 s antes do completo.
tipos: [reel]
apps: [filmcraft]
usa: [copy-e-hashtags]
entrada: video
formato: bruto
saidas:
  - saida/previa.mp4 1080x1920
  - saida/reel.mp4 1080x1920
  - saida/legendas.srt
  - saida/legenda.txt
  - editavel/reel.fcproj
---

O cliente gravou falando pra câmera, do jeito que deu: com pausa, com "é…",
começando a frase duas vezes. O reel é a mesma fala, sem nada disso, com a
câmera chegando perto nos cortes e a legenda na marca dele — porque a maioria
assiste sem som.

O que já está pronto quando você começa:
- o vídeo em `entrada/bruto.*`;
- a transcrição, palavra por palavra com o tempo de cada uma, em
  `entrada/transcricao.json` (e o texto corrido em `entrada/transcricao.txt`).
  Os tempos já foram encostados no som: palavra não esconde pausa.

## Passos (FilmCraft, pelo MCP)

1. `avisar_etapa` "preparando o vídeo", 8.
   - `media_import` com o caminho absoluto do bruto (devolve o id do item).
   - `command_run` `file.newSequence` `{"name": "reel", "width": 1080, "height": 1920, "fps": 30, "video": 2, "audio": 1}`.
   - `command_run` `timeline.place` `{"item": <id>, "track": "V1", "seconds": 0}`.
   - Vídeo que não é em pé: `effects.setParam` no clipe, `{"effect": "motion", "param": "scale", "value": <o que cobre 1080×1920>}`.
   - `command_run` `transcript.set` `{"item": <id>, "transcript": {"language": "pt", "speakers": [{"name": "Pessoa"}], "words": [...]}}`
     com as palavras do JSON (tempos em ticks: 254016000000 por segundo).

2. `avisar_etapa` "cortando as pausas", 20. Leia `transcript.inspect` e corte
   com `transcript.extract` `{"from": i, "to": j}` — **do fim pro começo**:
   - muleta que abre frase e fecha em vírgula ("É, tipo assim,", "Então,"). "é"
     no meio da frase é verbo: fica;
   - frase começada e repetida: sai a primeira ("Mas não precisa. Mas não precisa mesmo.");
   - erro que a pessoa corrige logo depois, se for claro;
   - nunca corte informação: preço, data, nome, prazo.
   Depois `transcript.removePauses` `{"minSeconds": 0.5, "keepSeconds": 0.12}`.

3. `avisar_etapa` "aproximando a câmera", 32. Em `sequence_inspect`, os
   clipes da trilha V1: nos que começam uma ideia nova ou dizem a frase forte,
   `effects.setParam` `scale` 12% acima do normal. Um sim, um não é o mínimo;
   não aproxime dois cortes seguidos.

4. `avisar_etapa` "legendando", 42.
   - `transcript.createCaptions` `{"maxChars": 18, "lines": 1, "minSeconds": 0.5, "maxSeconds": 2.2}`
   - `captions.export` `{"path": "<pasta do job>/saida/legendas.srt"}` — o
     cliente também recebe esse arquivo;
   - `captions.setTrack` `{"track": "C1", "enabled": false}` — a trilha de
     legenda do FilmCraft desenha errado as fontes de marca;
   - `legendas_da_marca` `{}`: desenha cada legenda na fonte e nas cores da
     marca e devolve os arquivos com o tempo de cada um;
   - `media_import` com todos os arquivos e `timeline.place` de cada um com
     `{"track": "new"}` no primeiro e `"V2"` nos outros, `"seconds": <início>`,
     `"duration": <(fim − início) em ticks>`.

5. `command_run` `file.saveAs` `{"path": "<pasta do job>/editavel/reel.fcproj"}`.

6. `avisar_etapa` "preparando a prévia", 58, e `exportar_video` `{"previa": true}`.
   O cliente vê os 15 primeiros segundos enquanto o resto termina.

7. `avisar_etapa` "finalizando o som", 72, e `exportar_video` `{"previa": false}`.
   Antes de exportar, `exportar_video` passa o som pelo SoundCraft: a fala
   ganha filtro de graves, de-esser e compressor, e a trilha da marca (quando
   o pedido tem) entra por baixo, abaixando onde há legenda. Por isso as
   legendas precisam estar em `saida/legendas.srt` antes. Não importe outro
   áudio nem mexa no volume da faixa "Som da Bora": a conferência lê a curva
   da trilha na sessão do SoundCraft. Volume em -16 LUFS é a exportação que
   garante.

8. `avisar_etapa` "escrevendo a legenda", 88, e a legenda do post como diz a
   parte "copy-e-hashtags" — sobre o que a pessoa disse no vídeo, não sobre o
   vídeo ("neste vídeo eu falo…" é desperdício da primeira linha).

## Quando o pedido é um ajuste

A versão anterior está em `entrada/anterior/reel.fcproj`. Abra com
`command_run` `file.open`, mude só o que foi pedido ("mais curto": corte mais
uma frase de pouco peso; "outra cor da marca": `legendas_da_marca` com o
próximo conjunto e troque os PNGs da V2), salve em `editavel/reel.fcproj` e
exporte prévia e completo de novo.
