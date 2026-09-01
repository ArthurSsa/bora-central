# Bora Postar — infraestrutura

Este repositório reúne o que está no ar hoje: os dois sites estáticos, as migrações do banco e a Edge Function que liga um ao outro.

```
sites/formulario/   Conhecendo Você(s) e Seu Trabalho — o formulário de 24 perguntas
sites/central/      Central Bora — o painel interno da agência
supabase/migrations/  SQL aplicado no projeto bora-postar
supabase/functions/   Edge Functions
```

Ambos os sites são um `index.html` autocontido, sem build. Isso é deliberado: menos coisa para quebrar e deploy instantâneo.

## O que está no ar

| O quê | Onde |
|---|---|
| Formulário | https://boraconhecer-arthurssas-projects.vercel.app |
| Central Bora | https://bora-central-arthurssas-projects.vercel.app |
| Banco e funções | Projeto Supabase `bora-postar` (`yxewmauwnxnrrhevlbtc`) |

## Como o dado circula

```
cliente preenche o formulário
        │
        ├──► jsPDF monta o PDF no navegador ──► Apps Script ──► e-mail com anexo
        │
        └──► Edge Function onboarding-intake ──► tabela onboarding_respostas
                                                          │
                                                          ▼
                                              Central Bora (caixa de entrada)
                                                          │
                                              vincula a um cliente
                                                          │
                                       metas · baseline · marcos · conformidade · horas
```

A gravação no banco roda em paralelo com o envio do e-mail e **nunca pode derrubá-lo**: a chamada é `try/catch` com `.catch()`, e uma falha ali é silenciosa para quem está preenchendo. A ordem de prioridade é essa mesmo — perder uma linha no banco é chato, perder o envio de um cliente é grave.

## Camada de agência

As tabelas `clientes`, `onboarding_respostas`, `baselines`, `metas`, `marcos`, `conformidade_itens` e `horas` são **aditivas**: nenhuma tabela do produto (marcas, vozes, ideias, carrosséis, reels, créditos) foi alterada.

Todas têm RLS e só são visíveis para quem tem `profiles.is_agency = true`. Um usuário comum do produto — inclusive um cliente com login próprio — não enxerga nada dessa camada.

Para marcar alguém como membro da agência:

```sql
update public.profiles set is_agency = true where id = '<uuid do usuário>';
```

## Pendências conhecidas

- `brand_profiles` tem `UNIQUE (user_id)` — um usuário, uma marca. Para a agência segurar N clientes numa conta só, essa restrição precisa cair. **Não remova sem o código do app à vista**: se houver `upsert(..., { onConflict: 'user_id' })`, o Postgres exige um índice único para `ON CONFLICT` e a operação passa a falhar.
- O `SHARED_SECRET` está no HTML público do formulário. Filtra ruído, não é autenticação. Para virar autenticação de verdade, a chamada precisa sair do navegador e ir para dentro do Apps Script, que roda no servidor.
- Google Apps Script: salvar o código não atualiza a URL pública. É preciso "Implantar → Gerenciar implantações → editar (lápis) → Nova versão → Implantar".

## Aprendizados que custaram caro

- **Nunca embutir PNG/JPG como base64 no código.** Blocos longos de base64 se corrompem em silêncio ao serem reescritos. SVG funciona, por ser texto estruturado. Depois de qualquer reescrita completa de um arquivo, vale baixar o publicado e comparar byte a byte com o local.
- **`html2canvas` embaralha texto** com `display:flex` + `letter-spacing` neste layout. O PDF é desenhado à mão com jsPDF, não é captura de tela.
