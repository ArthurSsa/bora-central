-- Registro de acessos às contas do cliente.
-- A Lacuna #5 aponta isso como o gargalo mais documentado do onboarding de agência:
-- trava semanas, e costuma travar porque ninguém sabe quem detém o quê.

create table if not exists public.acessos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  recurso text not null,
  quem_detem text,
  status text not null default 'pendente'
    check (status in ('pendente','solicitado','recebido','bloqueado','nao_aplicavel')),
  solicitado_em date,
  recebido_em date,
  nota text,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists acessos_cliente_idx on public.acessos(cliente_id);

alter table public.acessos enable row level security;

drop policy if exists bora_all on public.acessos;
create policy bora_all on public.acessos
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());
