# A prévia sai igual à exportação? (Fase 0, ADR 0001, D2)

- **Medido em:** 28/10/2026, nesta máquina: Konva 9.3.22 num Edge sem janela, contra o PhotoCraft
- **Como refazer:** `cd worker && npm run fidelidade -- --saida <pasta>` (sem rede e sem modelo; leva uns 2 minutos)
- **O que se compara:** 20 cenas (feed, story e capa; Manrope em seis pesos e Anton; à esquerda, no centro e à direita; títulos curtos e longos, texto corrido, quebra manual, palavra longa, caixa estreita, letra pequena, acentos, números, entrelinha 1,0 e 1,4; faixa, forma e logo com transparência). O navegador e a fábrica usam os mesmos arquivos de fonte (`fontes.json`).

## Resultado

| O que | Sem alinhar | Com a linha de base alinhada |
|---|---|---|
| Quebra de linha igual | 20 de 20 | 20 de 20 |
| Deslocamento vertical do texto | 4 a 17 px | 0 px em todas |
| Pixels diferentes nos textos (média) | 14,8% | 1,5% |
| Pixels diferentes nos textos (pior cena) | 23,2% | 3,7% (letra de 28 px) |
| Pixels diferentes na peça inteira (pior cena) | 7,2% | 0,8% |

**A quebra de linha não é problema.** Com o mesmo arquivo de fonte, o Konva e o PhotoCraft quebram cada texto exatamente nas mesmas palavras, nas 20 cenas: com acento, número, quebra manual, palavra que não cabe e caixa estreita. O risco número um do ADR não se confirmou.

**O que diferia era a altura do texto, e tem conta.** O Konva centraliza cada linha na entrelinha. O PhotoCraft põe a linha de base da primeira linha a uma distância fixa do topo da caixa, que depende só da fonte: 0,72 do tamanho na Manrope, em qualquer peso, e 0,86 na Anton. O navegador pede esse número à fábrica uma vez por fonte e peso (`baselineDaFabrica`, em `worker/src/cena.ts`), mede no próprio Edge onde o Konva põe a linha de base, e desloca o texto pela diferença. Com isso, o deslocamento some.

**O que sobra é a borda das letras.** Ampliando a pior cena, as letras estão no mesmo lugar; o Edge e o PhotoCraft só suavizam o contorno com tons um pouco diferentes. Em letra pequena, a borda é uma parte maior da letra, e por isso a conta sobe pra 3,7%. Não é diferença que alguém veja.

## O que muda no ADR

1. **Quem quebra a linha:** o navegador, ao editar, sem esperar a fábrica. A fábrica devolve as linhas que quebrou (`exportarCena` já faz) e a conferência compara as duas listas. Se um dia divergirem, o erro diz qual texto e em que palavra.
2. **A régua da conferência não é "% de pixels" com limite de 2%.** É: as mesmas linhas, deslocamento zero e, nas caixas de texto, até 4% de pixels diferentes, que é a borda das letras pequenas. Fora dos textos (formas, imagens, fundo), a diferença ficou abaixo de 0,8% e o limite pode ser 1%.
3. **Fonte nova entra no catálogo com a medida dela:** ao pôr uma fonte em `fontes.json`, mede-se a linha de base de cada peso usado (`baselineDaFabrica`) e guarda-se junto, pro navegador não precisar perguntar à fábrica.

## O que este teste não cobre ainda

- Rotação, sombra, cantos arredondados e faixa de fundo no texto (o formato `cena.v1` ainda não tem).
- Outros navegadores: a medida é no Edge (Chromium). O Safari do iPhone desenha a fonte de outro jeito, e precisa da mesma medida antes de o Studio ir pro celular (Fase 3).
- Telas de alta densidade: aqui a prévia é 1:1; no app ela vai ser reduzida pra caber na tela, o que esconde ainda mais a borda.
