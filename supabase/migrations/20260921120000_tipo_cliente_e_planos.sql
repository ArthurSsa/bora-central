-- Duas coisas que a virada pro nicho de tecnologia pede.

-- 1. Empresa ou solo.
--
-- O formulário passa a ter duas trilhas, e o plano do mês conclui coisas
-- diferentes pra cada uma: numa empresa a pergunta é quem decide a compra e
-- quanto tempo leva o ciclo; num profissional solo é a rotina e o preço. Coluna
-- de verdade porque a lista filtra e o plano ramifica por ela.
alter table public.clientes
  add column if not exists tipo_cliente text not null default 'solo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_tipo_cliente_check') then
    alter table public.clientes
      add constraint clientes_tipo_cliente_check check (tipo_cliente in ('solo','empresa'));
  end if;
end $$;

comment on column public.clientes.tipo_cliente is
  'solo = profissional que trabalha sozinho; empresa = venda B2B com mais de um decisor.';

-- 2. O plano do mês.
--
-- Guarda duas coisas separadas de propósito: o `diagnostico`, que é o que a
-- máquina concluiu lendo as respostas, congelado no dia em que foi gerado; e o
-- `plano`, que é o que uma pessoa (com ou sem IA) escreveu em cima daquilo.
--
-- Congelar o diagnóstico importa porque as respostas mudam: um plano escrito
-- em setembro contra um formulário editado em outubro vira um texto que não
-- bate com nada, e ninguém sabe dizer por quê.
create table if not exists public.planos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  mes date not null,
  diagnostico jsonb not null default '{}'::jsonb,
  plano text,
  pauta text,
  gerado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (cliente_id, mes)
);

comment on table public.planos is 'Plano de ação do mês por cliente. Um por cliente por mês.';
comment on column public.planos.mes is 'Primeiro dia do mês a que o plano se refere.';
comment on column public.planos.diagnostico is
  'O que a máquina concluiu lendo as respostas, congelado no dia da geração.';
comment on column public.planos.plano is 'O que a pessoa escreveu em cima do diagnóstico.';
comment on column public.planos.pauta is
  'Os temas do mês, um por linha — o mesmo formato que a tela de lote consome.';

create index if not exists planos_cliente_mes_idx on public.planos (cliente_id, mes desc);

alter table public.planos enable row level security;

drop policy if exists planos_membro on public.planos;
create policy planos_membro on public.planos
  for all using (public.is_bora_member()) with check (public.is_bora_member());

-- search_path fixo: o linter do Supabase cobra, e com razão — função de gatilho
-- sem caminho fixo pode ser induzida a chamar objeto plantado noutro schema.
create or replace function public.planos_tocar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists planos_tocar on public.planos;
create trigger planos_tocar before update on public.planos
  for each row execute function public.planos_tocar();
