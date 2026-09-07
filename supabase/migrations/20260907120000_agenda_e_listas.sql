-- 1. AGENDA. Uma tarefa é sempre de alguém, num dia. Sem esses dois campos ela
-- é um desejo, não um combinado — por isso responsavel e data não são nulos.
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  detalhe text,
  cliente_id uuid references public.clientes(id) on delete cascade,  -- nulo = tarefa interna
  responsavel text not null default 'os_dois',
  data date not null default current_date,
  hora time,
  estado text not null default 'pendente'
    check (estado in ('pendente','fazendo','concluido','cancelado')),
  concluido_em timestamptz,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists tarefas_data_idx on public.tarefas(data);
create index if not exists tarefas_cliente_idx on public.tarefas(cliente_id);

-- concluido_em se preenche e se apaga sozinho conforme o estado, para ninguém
-- precisar lembrar de marcar a data à mão.
create or replace function public.tarefa_tocada()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.estado = 'concluido' and (old.estado is distinct from 'concluido') then
    new.concluido_em := now();
  elsif new.estado <> 'concluido' then
    new.concluido_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tarefas_tocada on public.tarefas;
create trigger tarefas_tocada before update on public.tarefas
  for each row execute function public.tarefa_tocada();

-- 2. LISTAS. Um mecanismo só para guardar coisa: contratos hoje, fornecedores e
-- equipamentos amanhã. Criar uma tabela nova por assunto seria trocar seis
-- meses de trabalho por um formulário a mais.
create table if not exists public.listas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists public.lista_itens (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.listas(id) on delete cascade,
  titulo text not null,
  detalhe text,
  estado text not null default 'aberto'
    check (estado in ('aberto','fazendo','concluido','arquivado')),
  tags text[] not null default '{}',
  cliente_id uuid references public.clientes(id) on delete set null,
  valor numeric,
  data_inicio date,
  data_fim date,
  link text,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists lista_itens_lista_idx on public.lista_itens(lista_id);
create index if not exists lista_itens_cliente_idx on public.lista_itens(cliente_id);

alter table public.tarefas enable row level security;
alter table public.listas enable row level security;
alter table public.lista_itens enable row level security;

drop policy if exists bora_all on public.tarefas;
create policy bora_all on public.tarefas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());
drop policy if exists bora_all on public.listas;
create policy bora_all on public.listas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());
drop policy if exists bora_all on public.lista_itens;
create policy bora_all on public.lista_itens
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

-- Uma lista já nasce pronta, senão a tela abre vazia e ninguém sabe o que fazer.
insert into public.listas (nome, descricao, ordem)
select 'Contratos', 'Um item por contrato: cliente, valor, início e fim. A tag diz em que pé está.', 0
where not exists (select 1 from public.listas where nome = 'Contratos');
