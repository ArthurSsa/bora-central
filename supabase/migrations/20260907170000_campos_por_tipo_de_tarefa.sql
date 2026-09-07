-- Uma gravação e uma cobrança não têm as mesmas perguntas. Gravação pede
-- roteiro, formato, quantas peças e quem aparece; cobrança pede valor,
-- vencimento e forma de pagamento. Uma coluna por pergunta daria trinta
-- colunas nulas na maior parte das linhas, e cada tipo novo viraria migração.
-- Um saco jsonb por tarefa resolve, e o formulário de cada tipo mora no site.
--
-- O que NÃO vai aqui: qualquer coisa que precise ser somada, filtrada ou
-- cruzada entre tarefas. Isso continua sendo coluna de verdade — tipo, hora,
-- responsável, cliente, prioridade. jsonb é pro que só é lido junto com a
-- tarefa que o guarda.
alter table public.tarefas
  add column if not exists campos jsonb not null default '{}'::jsonb;

alter table public.tarefas drop constraint if exists tarefas_campos_ck;
alter table public.tarefas add constraint tarefas_campos_ck
  check (jsonb_typeof(campos) = 'object');
