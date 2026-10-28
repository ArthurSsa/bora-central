# Início automático do dia — Bora até Fevereiro

Você é o Claude Code rodando sozinho no PC do Arthur, no repositório `bora-central`, logo depois que o PC ligou (ou às 7h). **Ninguém vai responder perguntas durante esta execução**: decida pelo que está escrito aqui e deixe para o Arthur, por escrito, o que depende dele.

A data de hoje e a situação do git vêm na mensagem que abriu esta execução.

## 1. Ler o plano atualizado

Leia, nesta ordem:

1. `docs/progresso/LEIA-ME.md`
2. `docs/progresso/estado.md`
3. os 3 arquivos mais recentes de `docs/progresso/diario/` (frontmatter e texto)
4. `docs/progresso/tarefas.json`
5. `CLAUDE.md` e, se existir, `docs/adr/` (o mais recente)

Monte o estado real:

- **Feita**: alguma entrada de diário com `feita: true` para a tarefa.
- **Passos feitos**: união de `passos_feitos` de todos os diários + os passos com `ja`.
- **Do dia**: tarefas cujo período (`inicio` + `dias` úteis, sem fins de semana nem `feriados`) inclui hoje, e passos com `dia` igual a hoje.
- **Atrasadas**: período já acabou e a tarefa não está feita.

## 2. Escrever a pauta do dia

Escreva `docs/progresso/hoje.md` (substitui o de ontem) e uma cópia em `docs/progresso/pauta/AAAA-MM-DD.md`, neste formato:

```markdown
# Pauta de <dia da semana> DD/MM

> Montada pelo Claude Code às HH:MM · branch `dia/AAAA-MM-DD` · base: <main ou branch de ontem>

## Hoje sai
1. **#<id> <título>** (<área>, dia X de Y). Pronto quando: <pronto>.
   - [ ] <passo do dia> — `<comando>` (⏱ tempo)

## Atrasadas
- **#<id> <título>**: o que falta, em uma linha.

## Comecei sozinho
- **#<id> <título>**: plano em 5 linhas · o que ficou pronto (commits) · o que falta · como testar.

## Precisa de você
- Decisões, pagamentos, contas novas, pedidos pagos na fábrica, mensagens a enviar, conversas de venda.

## Rascunhos prontos
- `docs/progresso/rascunhos/AAAA-MM-DD/<arquivo>`: para quê.
```

Ordem de "Hoje sai": primeiro o que destrava outras tarefas, depois venda no horário fixo do ritmo (segunda prospecta, terça e quinta conversa, quarta conteúdo, sexta quadro), depois o resto. Seja realista: um dia de uma pessoa só.

## 3. Branch do dia

- Se a mensagem disser que a árvore tem mudanças não salvas: **não crie branch, não faça commit e não mexa em código**. Escreva só a pauta, avise no topo dela que o código não foi iniciado por causa das mudanças pendentes e encerre.
- Senão: `git switch -c dia/AAAA-MM-DD` a partir do commit atual. Se o branch já existir, `git switch dia/AAAA-MM-DD`. Se a base não for a `main` (o branch de ontem não foi juntado), diga isso na pauta.
- Faça o commit da pauta: `docs(progresso): pauta de AAAA-MM-DD`.

## 4. Começar a tarefa de código

Escolha **uma** tarefa de código do dia (área `produto` ou `fabrica`), ou a atrasada mais antiga se não houver nenhuma no dia. O Arthur autorizou esta execução a começar sem esperar o ok dele, **desde que tudo fique no branch do dia**.

- Escreva o plano em 5 linhas na seção "Comecei sozinho" antes de codar.
- Trabalhe em passos pequenos, com teste, e faça um commit por passo (`feat(...)`, `fix(...)`, `test(...)`).
- Rode os testes do pacote que mexeu (`npm test`, `npm run test`, `npm run build`, `npx tsc`). Teste vermelho não vai para o commit: conserte ou desfaça e anote.
- Pare quando o critério de pronto for cumprido, quando acabar o que dá para fazer sem o Arthur ou quando chegar perto do limite de turnos. Deixe o código compilando.

Tarefas que exigem conta nova, cartão, chave nova, compra de domínio ou pedido pago (gerador de imagem ou vídeo, lote da fábrica): **prepare tudo** (script, checklist, comando pronto, teto em dólar) e coloque o disparo em "Precisa de você". Não dispare.

Tarefas de venda e negócio do dia: deixe rascunhos em `docs/progresso/rascunhos/AAAA-MM-DD/` (mensagens, roteiro da conversa, texto) e liste em "Rascunhos prontos". Nada é enviado.

## 5. Fechar a execução

- Atualize `docs/progresso/hoje.md` e a cópia em `pauta/` com o que ficou pronto.
- Acrescente ao `docs/progresso/diario/AAAA-MM-DD.md` (crie se não existir, no formato do LEIA-ME) uma seção `## Claude Code (manhã)`. No frontmatter, marque em `passos_feitos` só o que ficou pronto de verdade e `feita: true` só se o "pronto quando" foi cumprido.
- Atualize `docs/progresso/estado.md`.
- Commit final: `docs(progresso): início do dia AAAA-MM-DD`.
- Termine com um resumo de até 5 linhas no terminal: o que sai hoje, o que você começou, o que precisa do Arthur.

## Nunca

- `git push`, `git merge`, `git rebase`, `git reset --hard`, apagar branch.
- Editar `.env` ou qualquer segredo, ou colocar chave em arquivo.
- Rodar pedidos pagos (`npm run fabrica*`, chamadas a APIs pagas), migração no Supabase de produção ou apagar dados.
- Enviar mensagem, e-mail ou post em nome de alguém.
- Apagar arquivos que não foram criados nesta execução.
