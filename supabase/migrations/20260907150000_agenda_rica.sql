-- A agenda guardava título, dia, hora e responsável, e a tela só deixava
-- escrever o título. Na prática isso vira "10h gravar reels com o Rafa no
-- estúdio" dentro de um campo de texto — e aí nada disso dá pra filtrar,
-- ordenar ou conferir. Aqui cada pedaço vira campo.

alter table public.tarefas
  add column if not exists tipo text not null default 'tarefa',
  add column if not exists hora_fim time,
  add column if not exists prioridade text not null default 'normal',
  add column if not exists local text,
  add column if not exists link text,
  add column if not exists passos jsonb not null default '[]'::jsonb,
  add column if not exists etiquetas text[] not null default '{}';

alter table public.tarefas drop constraint if exists tarefas_tipo_ck;
alter table public.tarefas add constraint tarefas_tipo_ck
  check (tipo in ('tarefa','gravacao','edicao','reuniao','publicacao','entrega','cobranca','prazo'));

alter table public.tarefas drop constraint if exists tarefas_prioridade_ck;
alter table public.tarefas add constraint tarefas_prioridade_ck
  check (prioridade in ('baixa','normal','alta'));

-- passos é uma lista de {t:texto, ok:booleano}. Uma tabela filha daria consulta
-- melhor, mas passo só é lido junto com a tarefa dele e nunca sozinho: seria um
-- join a mais e um formulário a mais pra nada.
alter table public.tarefas drop constraint if exists tarefas_passos_ck;
alter table public.tarefas add constraint tarefas_passos_ck
  check (jsonb_typeof(passos) = 'array');

-- Terminar antes de começar é erro de digitação, não combinado.
alter table public.tarefas drop constraint if exists tarefas_hora_ck;
alter table public.tarefas add constraint tarefas_hora_ck
  check (hora_fim is null or hora is null or hora_fim >= hora);

create index if not exists tarefas_tipo_idx on public.tarefas(tipo);
create index if not exists tarefas_data_hora_idx on public.tarefas(data, hora);
