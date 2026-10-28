---
name: bora-registrar-avanco
description: Registra o avanço do dia no plano "Bora até Fevereiro" — marca tarefas e passos no calendário, anexa as entregas e grava o diário no projeto e no repositório. Use quando pedirem para registrar, marcar ou fechar o dia da Bora.
---

# Registrar o avanço do dia — Bora até Fevereiro

O avanço de cada dia fica em três lugares que contam a mesma história. Grave em todos os que a sessão alcança.

| Lugar | Endereço | Quem alcança |
|---|---|---|
| Calendário | https://claude.ai/artifact/CHLU9HH2k1691UAq29KAC6 (banco do artefato: coleções `progresso` e `diario`) | sessões com a ferramenta `ArtifactData` (Cowork, claude.ai) |
| Pasta do projeto | projeto "Agência de Marketing" → `bora-progresso/` | sessões ligadas ao projeto (ferramenta `Projects`) |
| Repositório | `ArthurSsa/bora-central` → `docs/progresso/` | Claude Code no PC do Arthur |

O mapa das tarefas é `tarefas.json`, em `bora-progresso/` no projeto ou em `docs/progresso/` no repo. Cada tarefa tem `id`, `titulo`, `pronto` e `passos[]` com o índice `i` (a partir de 0), que é o mesmo índice que o calendário usa.

## 1. Levantar o que foi feito

- A conversa de hoje: o que foi entregue, medido ou decidido.
- No repositório: `git log --since=midnight --oneline` e `git status`.
- Documentos, artefatos e arquivos criados hoje, com os links.
- Datas no fuso de Fortaleza (America/Fortaleza). "Hoje" é a data local.

## 2. Mapear para tarefas e passos

- Encontre a tarefa pelo título ou pelo assunto em `tarefas.json`. Prefira as que estão no período de hoje ou atrasadas.
- **Passo** só é marcado quando foi feito de verdade. O que ficou pela metade vai na nota, não no passo.
- **Tarefa feita** só quando o "pronto quando" (`pronto`) foi cumprido. Na dúvida, deixe em andamento e diga o que falta.
- Trabalho que não cabe em nenhuma tarefa vai só no diário, sem inventar tarefa.

## 3. Gravar no calendário (se houver `ArtifactData`)

Para cada tarefa tocada:

1. `get` em `progresso` / `t<id>`. Guarde a `version`.
2. Monte o corpo **mesclando** com o que já existe. Nunca apague nota, passo ou anexo escrito por outra pessoa.
   - `passos`: `{"<i>": "AAAA-MM-DD"}` para cada passo feito hoje.
   - `feita: true` e `feitaEm: "AAAA-MM-DD"` só se o critério de pronto foi cumprido.
   - `nota`: acrescente uma linha `DD/MM (quem): o que foi feito, números, o que falta`. Mantenha as linhas anteriores.
   - `arquivos`: acrescente `{nome, url, tipo, data, por}` (`url` só com `https://`) ou `{nome, caminho, tipo: "projeto" | "repo", data, por}` para arquivos sem link. Não duplique o que já está lá (mesma `url` ou mesmo `caminho`).
   - Sempre `tarefa`, `titulo` e `atualizado` (ISO).
3. `set` com `if_version` (ou sem ele, se o documento não existia). Se der conflito de versão, leia de novo e refaça a mescla.

Depois, o dia: `get` em `diario` / `<AAAA-MM-DD>`, mescle e grave `{data, por, resumo, tarefas: [ids], arquivos: [...], atualizado}`. O `resumo` tem de 3 a 6 linhas, com números, e termina com "Falta: ...". Use `batch` quando forem vários documentos.

## 4. Gravar a pasta

No projeto (`project_write`) e/ou no repo (`docs/progresso/`):

- `diario/<AAAA-MM-DD>.md` com o formato abaixo. Se já existir, leia e mescle.
- `estado.md`: placar (feitas, em andamento, atrasadas), tabela "Em andamento" com o que falta, as próximas 5 tarefas e os números que valem agora.
- Entregas sem lugar melhor vão em `arquivos/` e entram no calendário pelo `caminho`.

No Claude Code, depois de escrever em `docs/progresso/`, faça o commit (`docs(progresso): AAAA-MM-DD`). Faça push só se o Arthur pedir. Sem `ArtifactData`, avise que o calendário será atualizado na próxima vez que esta skill rodar no Cowork. Ao rodar no Cowork, leia também os diários do repo (`git clone https://github.com/ArthurSsa/bora-central` ou `git pull`) que ainda não estão no banco `diario` e leve-os para o calendário.

### Formato do diário

```markdown
---
data: AAAA-MM-DD
por: Claude (Cowork) | Claude Code | Arthur
tarefas:
  - id: 1
    titulo: Medir o custo real por pedido
    passos_feitos: [1, 2]
    feita: false
arquivos:
  - nome: "Nome legível"
    url: https://...            # ou caminho: bora-progresso/arquivos/x.md
    tipo: doc | link | arquivo | projeto | repo
    tarefas: [1]
---

# <dia da semana>, DD/MM

## O que avançou
- **<tarefa> (tarefa N):** o que foi feito, com números.

## O que ficou faltando
- ...

## Amanhã
- ...
```

## 5. Responder

Duas ou três linhas: o que foi marcado (tarefa e passos), o que foi anexado e o que falta. Não repita o diário inteiro.

## Regras

- Nada de senha, chave de API ou dado de cliente em nota, diário ou anexo.
- Rodar duas vezes no mesmo dia mescla, não duplica.
- Se não achar a tarefa certa, pergunte antes de marcar.
