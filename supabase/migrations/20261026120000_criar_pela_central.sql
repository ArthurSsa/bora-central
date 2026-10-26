-- Criar pela Central: a equipe pede peças pra qualquer cliente pela mesma
-- fila e pela mesma fábrica do app. criar_pedido, pedir_ajuste, aprovar_pedido
-- e agendar_pedido já aceitam a equipe (pode_ver_cliente inclui a Bora);
-- o que falta é saber, depois, quem pediu.

alter table public.pedidos add column if not exists pela_equipe boolean not null default false;

comment on column public.pedidos.pela_equipe is
  'Pedido feito pela equipe da Bora (Central), não pelo cliente no app. Preenchido pelo banco na criação.';

-- Quem pediu é o banco quem diz, na hora de criar: não é campo que alguém escreve.
create or replace function public.pedidos_marca_quem_pediu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.pela_equipe := coalesce(public.is_bora_member(), false);
  return new;
end $$;

drop trigger if exists pedidos_quem_pediu on public.pedidos;
create trigger pedidos_quem_pediu before insert on public.pedidos
  for each row execute function public.pedidos_marca_quem_pediu();

revoke all on function public.pedidos_marca_quem_pediu() from public, anon, authenticated;
