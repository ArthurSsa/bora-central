# ADR 0002 — Nível de lucro de fevereiro

- **Estado:** proposto. **A decisão é do Arthur** (campo "Decisão" abaixo, em branco).
- **Data:** 03/11/2026
- **Tarefa:** #3 "Travar o nível de lucro de fevereiro", pronto quando "Decisão escrita com o valor de receita mínima de fevereiro"

## O que se decide

Quanto a Bora precisa faturar por mês em fevereiro de 2027, em um de três níveis (definidos no calendário do plano):

- **N1:** só as ferramentas se pagam.
- **N2:** as ferramentas e o pró-labore do Arthur.
- **N3:** as ferramentas e os dois pró-labores (no calendário, "os dois"; o valor do segundo também é do Arthur definir).

O plano recomenda **N2 em fevereiro e N3 em abril**.

## Os números (todos de 03/11; fontes no fim)

| O quê | Valor | De onde |
|---|---|---|
| Custo fixo de fevereiro | **R$ 612/mês** | Supabase Pro R$ 133, Vercel Pro R$ 107, VPS R$ 69 (com o PC desligado), domínio R$ 3, contador ~R$ 300 |
| IA por conta, na média | **R$ 54/mês** | 4 Autônomo (R$ 27), 5 Acompanhado (R$ 60), 1 Feito para você (R$ 134), da proposta da tarefa 9 |
| Receita por conta, na média | **R$ 616/mês** | a mesma mistura, com os preços propostos (R$ 297 / 697 / 1.490) |
| Imposto | 15,5% sem pró-labore (Anexo V); **6%** com pró-labore ≥ 28% da receita (Anexo III) | checklist da tarefa 10 |
| Taxa do Asaas | ~3,5% | cartão 2,99% + R$ 0,49; Pix R$ 2,15 |
| INSS do pró-labore | 11% (a confirmar com o contador) | checklist da tarefa 10 |

## A conta

Com `n` contas na mistura acima:

- **Receita:** R$ 616 × n.
- **Custo:** 612 + 54 × n + imposto e Asaas (sobre a receita) + 1,11 × pró-labore.
- **Receita mínima:** a menor receita em que a receita cobre o custo.

| Nível | Pró-labore | Imposto | Contas | **Receita mínima/mês** |
|---|---|---|---|---|
| **N1** | nenhum | 15,5% + 3,5% | 2 | **R$ 1.232** |
| **N2**, com 1 salário mínimo (R$ 1.621) | R$ 1.621 | 6% + 3,5% | 5 | **R$ 3.080** |
| **N2**, com R$ 3.000 | R$ 3.000 | 6% + 3,5% | 8 | **R$ 4.928** |
| **N2**, com R$ 5.000 | R$ 5.000 | 6% + 3,5% | 13 | **R$ 8.008** |
| **N3**, com R$ 3.000 cada | R$ 6.000 | 6% + 3,5% | 15 | **R$ 9.240** |

Como ler uma linha, com N2 e R$ 3.000:
- Cada conta deixa R$ 616 − 54 − 58,5 (9,5% de imposto e Asaas) = **R$ 503,50** de margem.
- O custo a cobrir é 612 de fixo + 3.330 de pró-labore com INSS = R$ 3.942.
- 3.942 ÷ 503,50 = 7,8, ou seja, **8 contas**.
- No N1, sem pró-labore, o imposto é 15,5%: cada conta deixa R$ 445, e 612 ÷ 445 = 1,4, ou seja, 2 contas.
- O pró-labore fica em 61% da receita, bem acima dos 28% do Fator R: a empresa fica no Anexo III (6%).

**Com as 10 contas que o plano prevê pra fevereiro**, a margem cobre um pró-labore de até **R$ 3.984/mês**: (10 × 503,50 − 612) ÷ 1,11. Isso é N2. O N3 pede 15 contas com R$ 3.000 cada.

## Recomendação

**N2, com pró-labore de R$ 3.000 e receita mínima de R$ 4.928/mês (8 contas na mistura proposta).**
- Cabe nas 10 contas de fevereiro com folga de 2 contas.
- O pró-labore põe a empresa no Anexo III, onde o imposto cai de 15,5% pra 6%: ele se paga em parte.
- O N3 em abril pede 15 contas, ou um preço médio maior.

## O que pode mudar estes números

- **O preço** da tarefa 9 ainda é proposta. Se o preço médio cair pra R$ 500, o N2 com R$ 3.000 pede 10 contas.
- **A geração de imagem e de vídeo** está pelo preço publicado, sem teste (falta a chave).
- **Custos fixos que só o Arthur sabe** (tarefa 2): faturas atuais, assinaturas, luz do PC. Eles somam ao fixo de R$ 612.
- **O contador** pode mudar o CNAE e, com ele, o anexo e o Fator R.

## Decisão

- Nível: 
- Pró-labore: 
- Receita mínima de fevereiro: 
- Decidido por e em: 

## Fontes

- Custo por pedido e os três meses: `docs/medidas/custo-por-pedido.md` (lote de 03/11)
- Geração: `docs/medidas/geradores-precos.md`
- Preços e níveis: `docs/progresso/dias/2026-11-03/t09-preco-e-niveis/proposta.md`
- Imposto, contador e Asaas: `docs/progresso/dias/2026-11-03/t10-cnpj/checklist-cnpj-e-asaas.md`
- Custos fixos: `docs/progresso/arquivos/custos-bora.md`
