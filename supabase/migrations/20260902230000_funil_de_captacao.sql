-- Captação. Até agora a Central só sabia de quem já era cliente; quem ainda
-- não é vivia numa planilha à parte, que é onde negócio de agência morre.
-- Uma oportunidade vira cliente quando fecha: cliente_id deixa de ser nulo.

create table if not exists public.oportunidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  contato text,                 -- WhatsApp, @, e-mail: o que existir
  origem text,                  -- indicação, mapa, Instagram, Raio-X...
  vertical text,
  bairro text,
  etapa text not null default 'mapeado'
    check (etapa in ('mapeado','contatado','conversando','reuniao','proposta','fechado','perdido')),
  valor_mensal numeric,         -- quanto se espera cobrar por mês
  proxima_acao text,
  proxima_acao_em date,
  perdido_motivo text,
  nota text,
  ordem int not null default 0,
  cliente_id uuid references public.clientes(id) on delete set null,
  -- Quando a etapa mudou pela última vez. É o que permite dizer "parado há 12
  -- dias" — o número que faz alguém agir, muito mais que a data de criação.
  movido_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists oportunidades_etapa_idx on public.oportunidades(etapa);
create index if not exists oportunidades_cliente_idx on public.oportunidades(cliente_id);

-- movido_em só se mexe quando a etapa muda de verdade; editar o nome ou a nota
-- não pode "rejuvenescer" um lead parado.
create or replace function public.oportunidade_movida()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  if new.etapa is distinct from old.etapa then
    new.movido_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists oportunidades_movida on public.oportunidades;
create trigger oportunidades_movida
  before update on public.oportunidades
  for each row execute function public.oportunidade_movida();

alter table public.oportunidades enable row level security;

drop policy if exists bora_all on public.oportunidades;
create policy bora_all on public.oportunidades
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());
