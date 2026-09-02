-- Lista de quem é da Bora. Serve para marcar is_agency automaticamente no momento
-- em que a conta for criada, sem depender de alguém lembrar de rodar um UPDATE depois.

create table if not exists public.bora_membros (
  email text primary key,
  nota text,
  criado_em timestamptz not null default now()
);

alter table public.bora_membros enable row level security;

drop policy if exists bora_all on public.bora_membros;
create policy bora_all on public.bora_membros
  for all to authenticated using (public.is_bora_member()) with check (public.is_bora_member());

insert into public.bora_membros (email, nota) values
  ('anabeatrizleite235@gmail.com', 'Ana Beatriz (Bia)'),
  ('arthursantossampaio90@gmail.com', 'Arthur')
on conflict (email) do nothing;

-- Marca o perfil como da agência quando o e-mail está na lista.
-- O bloco de exceção é deliberado: falhar em marcar alguém como membro nunca pode
-- impedir a criação de conta de um usuário comum do produto.
create or replace function public.marcar_membro_bora()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.bora_membros m
    join auth.users u on lower(u.email) = lower(m.email)
    where u.id = new.id
  ) then
    new.is_agency := true;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

revoke execute on function public.marcar_membro_bora() from anon, public;

drop trigger if exists profiles_marcar_membro on public.profiles;
create trigger profiles_marcar_membro
  before insert on public.profiles
  for each row execute function public.marcar_membro_bora();

-- Retroativo: quem já tem conta e está na lista fica marcado agora.
update public.profiles p
set is_agency = true
from auth.users u, public.bora_membros m
where p.id = u.id
  and lower(u.email) = lower(m.email)
  and p.is_agency is distinct from true;
