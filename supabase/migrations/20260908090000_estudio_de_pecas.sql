-- O registro profissional do cliente. Não é firula: o Art. 4º da Resolução
-- CONFEF 508/2023 exige nome e número do registro em TODA publicidade digital,
-- e o Bloco C anotou que essa é "a regra mais dura e a mais ignorada do
-- mercado". Guardando aqui, o estúdio assina a peça sozinho e ninguém esquece.
alter table public.clientes
  add column if not exists registro_profissional text;

-- Peça = o que vai ao ar. Carrossel, roteiro de vídeo ou legenda. O conteúdo
-- fica em jsonb porque cada tipo tem forma própria e vai mudar mais que a
-- tabela; o que precisa ser filtrado (cliente, tipo, data) é coluna.
create table if not exists public.pecas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  tipo text not null default 'carrossel'
    check (tipo in ('carrossel','roteiro','legenda')),
  titulo text not null,
  dados jsonb not null default '{}'::jsonb,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.pecas drop constraint if exists pecas_dados_ck;
alter table public.pecas add constraint pecas_dados_ck
  check (jsonb_typeof(dados) = 'object');

create index if not exists pecas_cliente_idx on public.pecas(cliente_id);
create index if not exists pecas_tipo_idx on public.pecas(tipo);

drop trigger if exists pecas_tocada on public.pecas;
create trigger pecas_tocada before update on public.pecas
  for each row execute function public.touch_atualizado_em();

alter table public.pecas enable row level security;
drop policy if exists bora_all on public.pecas;
create policy bora_all on public.pecas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());
