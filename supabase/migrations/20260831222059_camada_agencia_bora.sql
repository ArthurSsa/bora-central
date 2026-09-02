-- Camada "agência" da Bora Postar.
-- Puramente aditiva: não altera nenhuma tabela do produto existente.
-- Aplicada em produção em 31/08/2026.

-- 1. Quem é membro da Bora (separado de quem é usuário do produto)
alter table public.profiles
  add column if not exists is_agency boolean not null default false;

create or replace function public.is_bora_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_agency from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Cliente da agência
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_preferido text,
  vertical text,
  estagio text not null default 'prospect'
    check (estagio in ('prospect','onboarding','ativo','pausado','encerrado')),
  responsavel text,
  brand_profile_id uuid references public.brand_profiles(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  inicio_contrato date,
  fim_contrato date,
  primeiro_valor_prometido text,
  primeiro_valor_data date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clientes_estagio_idx on public.clientes(estagio);
drop trigger if exists clientes_touch on public.clientes;
create trigger clientes_touch before update on public.clientes
  for each row execute function public.touch_updated_at();

-- 3. Respostas do formulário de onboarding (cliente_id nulo até ser vinculado)
create table if not exists public.onboarding_respostas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  formulario text not null default 'conhecendo-voce',
  versao text not null default 'v1',
  nome_informado text,
  respostas jsonb not null,
  origem text,
  recebido_em timestamptz not null default now()
);
create index if not exists onboarding_respostas_cliente_idx on public.onboarding_respostas(cliente_id);
create index if not exists onboarding_respostas_recebido_idx on public.onboarding_respostas(recebido_em desc);

-- 4. Baseline congelado (Lacuna #3, Parte 5)
create table if not exists public.baselines (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  metrica text not null,
  fonte text check (fonte in ('perfil_empresa','instagram','whatsapp','site','negocio','outro')),
  valor numeric,
  valor_texto text,
  unidade text,
  janela_inicio date,
  janela_fim date,
  congelado_em timestamptz not null default now(),
  print_url text,
  limitacao text
);
create index if not exists baselines_cliente_idx on public.baselines(cliente_id);

-- 5. Pré-registro de metas (Lacuna #3 Parte 6.1 + Lacuna #5 Parte 4)
create table if not exists public.metas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  metrica text not null,
  tipo text not null default 'antecedente' check (tipo in ('antecedente','resultado')),
  valor_partida numeric,
  sucesso_30 text,
  sucesso_60 text,
  sucesso_90 text,
  fracasso text,
  prazo_realista_meses int,
  registrado_em timestamptz not null default now(),
  registrado_por text
);
create index if not exists metas_cliente_idx on public.metas(cliente_id);

-- 6. Marcos do documento de uma página (Lacuna #5)
create table if not exists public.marcos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  titulo text not null,
  descricao text,
  data_prevista date,
  data_cumprida date,
  responsavel text not null default 'bora' check (responsavel in ('bora','cliente')),
  ordem int not null default 0
);
create index if not exists marcos_cliente_idx on public.marcos(cliente_id);

-- 7. Checklist de conformidade com aprovação rastreável (Bloco C + Bloco G Parte 2)
create table if not exists public.conformidade_itens (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  vertical text,
  norma text,
  item text not null,
  status text not null default 'pendente'
    check (status in ('pendente','conforme','nao_conforme','nao_aplicavel')),
  aprovado_por text,
  aprovado_em timestamptz,
  nota text
);
create index if not exists conformidade_cliente_idx on public.conformidade_itens(cliente_id);

-- 8. Diário de horas (critério de saída #5 da Fase 0 — custo medido, não estimado)
create table if not exists public.horas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  data date not null default current_date,
  minutos int not null check (minutos > 0),
  atividade text not null,
  categoria text check (categoria in ('coleta','relatorio','conteudo','reuniao','conformidade','comercial','admin','outro')),
  quem text,
  faturavel boolean not null default true,
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists horas_cliente_idx on public.horas(cliente_id);
create index if not exists horas_data_idx on public.horas(data desc);

-- 9. RLS: só membros da Bora enxergam a camada de agência
alter table public.clientes             enable row level security;
alter table public.onboarding_respostas enable row level security;
alter table public.baselines            enable row level security;
alter table public.metas                enable row level security;
alter table public.marcos               enable row level security;
alter table public.conformidade_itens   enable row level security;
alter table public.horas                enable row level security;

drop policy if exists bora_all on public.clientes;
create policy bora_all on public.clientes
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists bora_all on public.onboarding_respostas;
create policy bora_all on public.onboarding_respostas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists bora_all on public.baselines;
create policy bora_all on public.baselines
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists bora_all on public.metas;
create policy bora_all on public.metas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists bora_all on public.marcos;
create policy bora_all on public.marcos
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists bora_all on public.conformidade_itens;
create policy bora_all on public.conformidade_itens
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

drop policy if exists bora_all on public.horas;
create policy bora_all on public.horas
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

-- 10. is_bora_member() não precisa ser chamável por visitante anônimo
revoke execute on function public.is_bora_member() from anon, public;
grant execute on function public.is_bora_member() to authenticated, service_role;
revoke execute on function public.touch_updated_at() from anon, public;
