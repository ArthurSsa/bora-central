-- A fábrica: conta como inquilino, pedido, e a fila de jobs que o worker consome.
--
-- Até aqui o isolamento era um só: is_bora_member() vê tudo, o resto não vê
-- nada. Isso basta enquanto só a Bora usa o sistema; deixa de bastar no dia em
-- que o Moacyr entra pelo celular pra pedir um post. Esta migração põe a CONTA
-- como inquilino, sem mudar o que já funciona: toda política existente continua
-- igual, e os seis clientes de hoje entram na conta da Bora.
--
-- Aditiva. Nenhuma tabela existente perde coluna nem muda de comportamento.

-- 1. Contas.
create table if not exists public.contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

comment on table public.contas is
  'O inquilino. Uma agência (a Bora) ou um negócio que contrata direto. Tudo herda por cliente_id.';

-- Id fixo: o default de clientes.conta_id aponta pra ela, e a Central e o
-- Estúdio continuam criando cliente sem saber que conta existe.
insert into public.contas (id, nome)
values ('b0a00000-0000-4000-8000-000000000001', 'Bora Postar')
on conflict (id) do nothing;

-- 2. Quem pertence a cada conta.
--
-- 'cliente' é o dono do negócio atendido: vê só o cliente_id dele. 'dono' e
-- 'equipe' veem todos os clientes da conta. A Bora não precisa de linha aqui:
-- is_bora_member() continua valendo como suporte, explícito nos termos do beta.
create table if not exists public.conta_membros (
  conta_id uuid not null references public.contas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null check (papel in ('dono','equipe','cliente')),
  cliente_id uuid references public.clientes(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (conta_id, user_id),
  constraint conta_membros_cliente_so_no_papel_cliente
    check ((papel = 'cliente') = (cliente_id is not null))
);

create index if not exists conta_membros_user_idx on public.conta_membros (user_id);

-- 3. O cliente passa a pertencer a uma conta.
alter table public.clientes
  add column if not exists conta_id uuid not null
    default 'b0a00000-0000-4000-8000-000000000001'
    references public.contas(id) on delete restrict;

-- Alvo da chave composta de pedidos/jobs: garante que conta e cliente batem.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_id_conta_unico') then
    alter table public.clientes add constraint clientes_id_conta_unico unique (id, conta_id);
  end if;
end $$;

create index if not exists clientes_conta_idx on public.clientes (conta_id);

comment on column public.clientes.conta_id is
  'Conta dona do cliente. Default = Bora, pra Central e Estúdio seguirem criando cliente como antes.';

-- 4. Quem pode ver o quê.
--
-- Uma função só decide, e toda política chama ela. Security definer porque lê
-- conta_membros e clientes, que o usuário comum não enxerga direto.
create or replace function public.pode_ver_cliente(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_bora_member()
      or exists (
        select 1
        from public.conta_membros m
        join public.clientes c on c.conta_id = m.conta_id
        where m.user_id = auth.uid()
          and c.id = p_cliente
          and (m.papel in ('dono','equipe') or m.cliente_id = p_cliente)
      );
$$;

revoke all on function public.pode_ver_cliente(uuid) from public, anon;
grant execute on function public.pode_ver_cliente(uuid) to authenticated, service_role;

alter table public.contas enable row level security;
alter table public.conta_membros enable row level security;

drop policy if exists contas_ler on public.contas;
create policy contas_ler on public.contas for select using (
  public.is_bora_member()
  or exists (select 1 from public.conta_membros m where m.conta_id = contas.id and m.user_id = auth.uid())
);
drop policy if exists contas_bora on public.contas;
create policy contas_bora on public.contas for all
  using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists conta_membros_ler on public.conta_membros;
create policy conta_membros_ler on public.conta_membros for select
  using (public.is_bora_member() or user_id = auth.uid());
drop policy if exists conta_membros_bora on public.conta_membros;
create policy conta_membros_bora on public.conta_membros for all
  using (public.is_bora_member()) with check (public.is_bora_member());

-- 5. Pedidos.
--
-- O pedido é o que o cliente vê e aprova; o job é uma rodada da fábrica em cima
-- dele. Um pedido tem vários jobs: a produção, cada ajuste, as variações, a
-- prévia e o completo de um vídeo. Juntar os dois numa tabela faria "pedir
-- ajuste" apagar o histórico do que foi feito antes.
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null,
  cliente_id uuid not null,
  tipo text not null check (tipo in
    ('post-feed','carrossel','story','reel','capa','apresentacao')),
  titulo text,
  briefing jsonb not null default '{}'::jsonb check (jsonb_typeof(briefing) = 'object'),
  estado text not null default 'rascunho' check (estado in
    ('rascunho','produzindo','para_aprovar','aprovado','agendado','publicado','cancelado')),
  publicar_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  foreign key (cliente_id, conta_id) references public.clientes(id, conta_id)
    on delete cascade on update cascade
);

comment on table public.pedidos is
  'O que o cliente pediu, na linguagem dele. As rodadas de produção ficam em jobs.';
comment on column public.pedidos.briefing is
  'Texto do pedido, escolhas guiadas e anexos. Nunca guarda decisão técnica (resolução, fonte): isso é da skill.';

create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id, criado_em desc);
create index if not exists pedidos_conta_estado_idx on public.pedidos (conta_id, estado);

-- 6. Jobs.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  conta_id uuid not null,
  cliente_id uuid not null,
  rodada text not null default 'producao' check (rodada in
    ('producao','ajuste','variacoes','previa','completo')),
  skill text,
  entrada jsonb not null default '{}'::jsonb check (jsonb_typeof(entrada) = 'object'),
  estado text not null default 'na_fila' check (estado in
    ('na_fila','rodando','pronto','falhou','cancelado')),
  etapa text,
  progresso numeric(5,2) not null default 0 check (progresso between 0 and 100),
  previsto_para timestamptz,
  saidas jsonb not null default '[]'::jsonb check (jsonb_typeof(saidas) = 'array'),
  erro text,
  tentativas integer not null default 0,
  max_tentativas integer not null default 3,
  worker_id text,
  lease_ate timestamptz,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  tokens_cache_leitura bigint not null default 0,
  tokens_cache_escrita bigint not null default 0,
  custo_usd numeric(10,4) not null default 0,
  render_segundos numeric(10,2) not null default 0,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  terminado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  foreign key (cliente_id, conta_id) references public.clientes(id, conta_id)
    on delete cascade on update cascade
);

comment on table public.jobs is
  'Uma rodada da fábrica sobre um pedido. O worker pega com pegar_job() e escreve com service_role.';
comment on column public.jobs.skill is
  'A skill que o worker escolheu (ou que a Bora forçou). O cliente nunca vê este nome.';
comment on column public.jobs.etapa is
  'Frase em português pro cliente: "desenhando os slides", "finalizando o som".';
comment on column public.jobs.saidas is
  'Lista de {caminho, papel: saida|editavel, mime, bytes, largura?, altura?}. Caminho relativo ao balde pedidos.';
comment on column public.jobs.render_segundos is
  'Tempo de parede gasto dentro dos apps (render, export). Entra na precificação junto com os tokens.';

-- A fila: só o que está esperando, em ordem de chegada.
create index if not exists jobs_fila_idx on public.jobs (criado_em) where estado = 'na_fila';
create index if not exists jobs_lease_idx on public.jobs (lease_ate) where estado = 'rodando';
create index if not exists jobs_pedido_idx on public.jobs (pedido_id, criado_em desc);

-- 7. Eventos: o log por pedido.
--
-- visivel_cliente separa o que vira linha na tela de acompanhamento ("animando")
-- do que só a Bora lê ("command_run file.new → ok, 140 ms").
create table if not exists public.job_eventos (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  cliente_id uuid not null,
  nivel text not null default 'info' check (nivel in ('info','aviso','erro')),
  mensagem text not null,
  dados jsonb,
  visivel_cliente boolean not null default false,
  criado_em timestamptz not null default now()
);

create index if not exists job_eventos_job_idx on public.job_eventos (job_id, id);

-- 8. Conta e cliente não podem vir de quem escreve.
--
-- O pedido herda a conta do cliente; o job e o evento herdam do pedido e do
-- job. Mesmo com a chave composta, preencher aqui tira do chamador a chance de
-- mandar a conta errada e só descobrir no erro de FK.
create or replace function public.pedidos_herda_conta()
returns trigger language plpgsql set search_path = '' as $$
begin
  select c.conta_id into new.conta_id from public.clientes c where c.id = new.cliente_id;
  return new;
end $$;

create or replace function public.jobs_herda_pedido()
returns trigger language plpgsql set search_path = '' as $$
begin
  select p.conta_id, p.cliente_id into new.conta_id, new.cliente_id
  from public.pedidos p where p.id = new.pedido_id;
  return new;
end $$;

create or replace function public.job_eventos_herda_job()
returns trigger language plpgsql set search_path = '' as $$
begin
  select j.cliente_id into new.cliente_id from public.jobs j where j.id = new.job_id;
  return new;
end $$;

create or replace function public.fila_tocar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists pedidos_herda_conta on public.pedidos;
create trigger pedidos_herda_conta before insert or update of cliente_id on public.pedidos
  for each row execute function public.pedidos_herda_conta();

drop trigger if exists jobs_herda_pedido on public.jobs;
create trigger jobs_herda_pedido before insert or update of pedido_id on public.jobs
  for each row execute function public.jobs_herda_pedido();

drop trigger if exists job_eventos_herda_job on public.job_eventos;
create trigger job_eventos_herda_job before insert on public.job_eventos
  for each row execute function public.job_eventos_herda_job();

drop trigger if exists pedidos_tocar on public.pedidos;
create trigger pedidos_tocar before update on public.pedidos
  for each row execute function public.fila_tocar();

drop trigger if exists jobs_tocar on public.jobs;
create trigger jobs_tocar before update on public.jobs
  for each row execute function public.fila_tocar();

-- 9. Quem lê e quem escreve.
--
-- O cliente LÊ pedidos, jobs e eventos visíveis do que é dele. Não escreve em
-- jobs nunca: estado, custo e saídas são do worker, que entra com service_role
-- e passa por cima do RLS. Criar e aprovar pedido vira RPC no passo 2, com a
-- validação de negócio dentro; por enquanto só a Bora escreve em pedidos.
alter table public.pedidos enable row level security;
alter table public.jobs enable row level security;
alter table public.job_eventos enable row level security;

drop policy if exists pedidos_ler on public.pedidos;
create policy pedidos_ler on public.pedidos for select using (public.pode_ver_cliente(cliente_id));
drop policy if exists pedidos_bora on public.pedidos;
create policy pedidos_bora on public.pedidos for all
  using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists jobs_ler on public.jobs;
create policy jobs_ler on public.jobs for select using (public.pode_ver_cliente(cliente_id));

drop policy if exists job_eventos_ler on public.job_eventos;
create policy job_eventos_ler on public.job_eventos for select using (
  public.is_bora_member() or (visivel_cliente and public.pode_ver_cliente(cliente_id))
);

-- 10. A fila propriamente dita.
--
-- FOR UPDATE SKIP LOCKED: dois workers chamando ao mesmo tempo nunca pegam o
-- mesmo job, e nenhum espera o outro. O lease é o que recupera job de worker
-- que morreu no meio: venceu o prazo sem renovar, o job volta a ser pegável —
-- até esgotar as tentativas, e aí falha com o motivo escrito, em vez de ficar
-- "rodando" pra sempre.
create or replace function public.pegar_job(p_worker text, p_lease_segundos integer default 600)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
     set estado = 'falhou',
         erro = coalesce(erro, 'o worker parou de responder ' || tentativas || ' vezes'),
         terminado_em = now()
   where estado = 'rodando' and lease_ate < now() and tentativas >= max_tentativas;

  return query
  update public.jobs j
     set estado = 'rodando',
         worker_id = p_worker,
         lease_ate = now() + make_interval(secs => p_lease_segundos),
         tentativas = j.tentativas + 1,
         iniciado_em = coalesce(j.iniciado_em, now())
   where j.id = (
     select f.id from public.jobs f
      where f.estado = 'na_fila'
         or (f.estado = 'rodando' and f.lease_ate < now() and f.tentativas < f.max_tentativas)
      order by f.criado_em
      for update skip locked
      limit 1
   )
  returning j.*;
end $$;

revoke all on function public.pegar_job(text, integer) from public, anon, authenticated;
grant execute on function public.pegar_job(text, integer) to service_role;

-- 11. Balde dos pedidos.
--
-- pedidos/<conta>/<cliente>/<pedido>/<job>/saida/…     o cliente vê
-- pedidos/<conta>/<cliente>/<pedido>/<job>/editavel/…  só a Bora vê
--
-- Fechado, sem URL pública: a tela pede link assinado. Quem escreve é o worker.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pedidos', 'pedidos', false, 524288000)
on conflict (id) do nothing;

create or replace function public.pode_ler_arquivo_pedido(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  partes text[] := storage.foldername(p_nome);
begin
  if public.is_bora_member() then
    return true;
  end if;
  -- Caminho fora do formato não é erro de cast no meio de uma política: é não.
  if coalesce(array_length(partes, 1), 0) < 5
     or partes[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or partes[5] <> 'saida' then
    return false;
  end if;
  return public.pode_ver_cliente(partes[2]::uuid);
end $$;

revoke all on function public.pode_ler_arquivo_pedido(text) from public, anon;
grant execute on function public.pode_ler_arquivo_pedido(text) to authenticated, service_role;

drop policy if exists pedidos_ler on storage.objects;
create policy pedidos_ler on storage.objects for select to authenticated
  using (bucket_id = 'pedidos' and public.pode_ler_arquivo_pedido(name));

-- 12. Tempo real: a tela de acompanhamento escuta, não pergunta de 2 em 2 s.
do $$
declare t text;
begin
  foreach t in array array['pedidos','jobs','job_eventos'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
