# Bora — pasta de progresso

Esta pasta guarda o avanço diário do plano "Bora até Fevereiro". Qualquer sessão do Claude (Cowork, chat ou Claude Code) ligada ao projeto "Agência de Marketing" pode ler o que está aqui antes de trabalhar e escrever aqui no fim do dia.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `estado.md` | Onde o plano está agora: tarefas feitas, em andamento, atrasadas e as próximas. Leia este primeiro. |
| `tarefas.json` | As 131 tarefas do calendário, com id, datas, critério de pronto e passos numerados (`i`, a partir de 0). É o mapa para saber qual tarefa e qual passo marcar. |
| `diario/AAAA-MM-DD.md` | Um arquivo por dia: o que avançou, quais tarefas e passos, quais arquivos saíram. |
| `hoje.md` | Pauta do dia, montada sozinha pelo Claude Code quando o PC do Arthur liga (só no repositório). |
| `pauta/AAAA-MM-DD.md` | Histórico das pautas (só no repositório). |
| `rascunhos/AAAA-MM-DD/` | Mensagens e textos que o Claude Code deixa prontos para o dia; nada é enviado sozinho (só no repositório). |
| `arquivos/` | Entregas que não têm lugar melhor (ex.: `custos-bora.md`). Documentos longos ficam no Claude Docs e entram aqui só como link. |

## Onde mais o progresso aparece

- **Calendário:** [Bora até Fevereiro](https://claude.ai/artifact/CHLU9HH2k1691UAq29KAC6). Cada tarefa mostra passos marcados, anotação e anexos; o "Diário de avanço" fica abaixo do quadro de hoje. Os dados ficam no banco do próprio calendário:
  - `progresso/t<id>`: `{tarefa, titulo, feita, feitaEm, passos: {"<i>": "AAAA-MM-DD"}, nota, arquivos: [...], atualizado}`
  - `diario/<AAAA-MM-DD>`: `{data, por, resumo, tarefas: [ids], arquivos: [...], atualizado}`
  - cada arquivo: `{nome, url (só https) ou caminho (no projeto ou no repo), tipo: doc | link | arquivo | projeto | repo, data, por}`
- **Repositório** `ArthurSsa/bora-central`: `docs/progresso/` (mesma estrutura, para o Claude Code no PC do Arthur).

## Início automático do dia (PC do Arthur)

O script `scripts/bora-dia/iniciar-dia.ps1` do repositório roda uma vez por dia útil, ao entrar no Windows ou às 7h, o que vier primeiro. Ele atualiza a `main`, chama o Claude Code com `scripts/bora-dia/prompt-do-dia.md`, escreve `hoje.md` e começa a tarefa de código no branch `dia/AAAA-MM-DD`. Nunca faz push nem dispara pedido pago. Instalação: `scripts/bora-dia/instalar.bat`.

## Como registrar um dia

Use a skill **bora-registrar-avanco** (no Cowork, no chat ou no Claude Code). Sem a skill, o passo a passo é:

1. Levantar o que foi feito: a conversa, `git log --since=midnight`, documentos e arquivos novos.
2. Achar a tarefa e o passo em `tarefas.json`. Passo só é marcado quando foi feito de verdade; o que ficou pela metade vai na nota.
3. Tarefa só vira **feita** quando o "pronto quando" foi cumprido.
4. Gravar no calendário (`progresso/t<id>` e `diario/<data>`), mesclando com o que já está lá: nunca apagar nota ou anexo escrito por outra pessoa.
5. Escrever `diario/<data>.md` aqui e atualizar `estado.md`.

Datas no fuso de Fortaleza. Rodar duas vezes no mesmo dia mescla, não duplica.
