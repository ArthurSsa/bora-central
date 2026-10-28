# Pacote para o repositório bora-central

Traz três coisas: a pasta de progresso (`docs/progresso/`), a skill de registro (`.claude/skills/bora-registrar-avanco/`) e o início automático do dia (`scripts/bora-dia/`).

## Instalar (uma vez, no PC do Arthur)

1. Descompacte este zip na raiz do repositório `bora-central`.
2. Acrescente ao `CLAUDE.md` do repositório:

   ```markdown
   ## Progresso do plano
   Antes de começar, leia `docs/progresso/hoje.md` (pauta do dia), `docs/progresso/estado.md` e o último arquivo de `docs/progresso/diario/`.
   Ao terminar o dia (ou quando o Arthur pedir "registra o avanço"), use a skill `bora-registrar-avanco`.
   ```

3. Faça o commit na `main`:
   `git add docs/progresso .claude/skills scripts/bora-dia CLAUDE.md && git commit -m "chore: progresso diário e início automático do dia"`
4. Confira que o Claude Code está logado: abra um terminal, rode `claude` uma vez e saia.
5. Dê dois cliques em `scripts\bora-dia\instalar.bat`. Se der erro de permissão, clique com o botão direito e escolha "Executar como administrador".
6. Teste agora: dois cliques em `scripts\bora-dia\rodar-agora.bat`. Ao terminar, abre `docs\progresso\hoje.md`.

## Como funciona

- **Quando:** ao entrar no Windows (2 minutos depois) e às 7h. Se o PC estava desligado às 7h, roda assim que ligar. Só uma vez por dia útil; pula fins de semana e os feriados do plano.
- **O que faz:** atualiza a `main` (só se não houver mudança pendente), lê `docs/progresso/`, escreve a pauta em `hoje.md`, cria o branch `dia/AAAA-MM-DD`, começa a tarefa de código do dia com testes e commits, deixa rascunhos de venda em `docs/progresso/rascunhos/` e registra no diário.
- **O que nunca faz:** push, merge, editar `.env`, rodar pedido pago da fábrica, enviar mensagem. Pedidos pagos e decisões vão para a seção "Precisa de você" da pauta.
- **Se houver mudança não salva no repositório:** só escreve a pauta e não mexe no código.
- **No fim do dia:** revise o branch do dia, junte na `main` e rode a skill `bora-registrar-avanco` ("registra o avanço de hoje"). O diário e o `estado.md` atualizados são o que a execução do dia seguinte vai ler.
- **Registro de cada execução:** `%LOCALAPPDATA%\bora-dia\logs\AAAA-MM-DD.log`.
- **Desligar:** `scripts\bora-dia\desinstalar.bat`.

Este arquivo pode ser apagado depois.
