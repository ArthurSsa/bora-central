-- touch_updated_at() escreve em new.updated_at. As tabelas paginas e lista_itens
-- chamam a coluna de atualizado_em/atualizada_em, então o trigger estourava em
-- TODO update — o que deixava o "Aplicar tudo" da página do cliente sem gravar
-- nada quando a linha já existia. Uma função por nome de coluna, explícita.
create or replace function public.touch_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create or replace function public.touch_atualizada_em()
returns trigger language plpgsql as $$
begin
  new.atualizada_em = now();
  return new;
end;
$$;

revoke execute on function public.touch_atualizado_em() from anon, public;
revoke execute on function public.touch_atualizada_em() from anon, public;

drop trigger if exists paginas_touch on public.paginas;
create trigger paginas_touch before update on public.paginas
  for each row execute function public.touch_atualizada_em();

drop trigger if exists lista_itens_touch on public.lista_itens;
create trigger lista_itens_touch before update on public.lista_itens
  for each row execute function public.touch_atualizado_em();
