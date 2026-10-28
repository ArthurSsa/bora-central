# bora-central

Visão geral do repositório no `README.md`. As decisões da Fase 0 estão em `docs/adr/`.

## Testes

- Fábrica (`worker/`): `cd worker && npm test` e `cd worker && npx tsc --noEmit -p .`. Sem `node_modules`, rode `npm ci` antes. Testes que dependem de ferramentas locais (VectorCraft etc.) aparecem como pulados.
- Os sites (`sites/`) são `index.html` sem build.

## Progresso do plano
Antes de começar, leia `docs/progresso/hoje.md` (pauta do dia), `docs/progresso/estado.md` e o último arquivo de `docs/progresso/diario/`.
Ao terminar o dia (ou quando o Arthur pedir "registra o avanço"), use a skill `bora-registrar-avanco`.
